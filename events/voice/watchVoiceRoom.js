const { Events, ChannelType } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, EndBehaviorType, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const prism = require('prism-media');
const speech = require('@google-cloud/speech');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const textToSpeech = require('@google-cloud/text-to-speech');
const { Readable } = require('stream');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
const credentials = JSON.parse(process.env.DISCORD_CREDENTIALS_JSON);
const speechClient = new speech.SpeechClient({ credentials });
const ttsClient = new textToSpeech.TextToSpeechClient({ credentials });

const TARGET_CHANNEL_ID = "1353292092016693282";
let isListening = false;

// STT 설정
const sttRequest = {
    config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 48000,
        languageCode: 'ko-KR',
    },
    interimResults: false,
};

function startListening(connection) {
    console.log("음성 듣기 시작!");
    connection.receiver.speaking.on('start', (userId) => {
        if (isListening) return;
        isListening = true;
        console.log(`${userId} 님이 말을 시작했습니다.`);

        const audioStream = connection.receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: 1000,
            },
        });

        const recognizeStream = speechClient
            .streamingRecognize(sttRequest)
            .on('error', (error) => {
                console.error('STT 스트림 오류:', error);
                isListening = false;
            })
            .on('data', async (data) => {
                const transcript = data.results[0]?.alternatives[0]?.transcript;
                if (transcript) {
                    console.log(`[STT 결과] ${transcript}`);
                    recognizeStream.destroy();

                    try {
                        const systemInstruction = "너는 음성으로 대화하는 AI 비서야. 답변은 항상 마크다운이나 특수기호 없이, 실제 대화처럼 유연하게 해줘.";
                        const result = await model.generateContent([systemInstruction, transcript]);
                        const response = await result.response;
                        const text = response.text();
                        console.log(`[Gemini 답변] ${text}`);

                        const [ttsResponse] = await ttsClient.synthesizeSpeech({
                            input: { text: text },
                            voice: { languageCode: 'ko-KR', name: 'ko-KR-Chirp3-HD-Sulafat' },
                            audioConfig: { audioEncoding: 'MP3' },
                        });

                        const audioBuffer = ttsResponse.audioContent;
                        const ttsStream = new Readable({
                            read() {
                                this.push(audioBuffer);
								this.push(null);
                            }
                        });

                        const player = createAudioPlayer();
                        const resource = createAudioResource(ttsStream);
                        
                        connection.subscribe(player);
                        player.play(resource);

                        player.on('idle', () => {
                            console.log('TTS 재생 완료. 다시 들을 준비 완료.');
                            isListening = false;
                        });

                    } catch (error) {
                        console.error('Gemini/TTS 처리 중 오류:', error);
                        isListening = false;
                    }
                }
            });

        const pcmStream = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
        audioStream.pipe(pcmStream).pipe(recognizeStream);

        audioStream.on('end', () => {
            console.log('사용자 음성 스트림 종료.');
        });
    });
}


module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        if (newState.member.user.bot) return;

        const client = newState.client;
        const targetChannel = await client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
        if (!targetChannel || targetChannel.type !== ChannelType.GuildVoice) {
            console.log(`ID가 ${TARGET_CHANNEL_ID}인 음성 채널을 찾을 수 없어. ID를 다시 확인해줘!`);
            return;
        }

        // 사용자가 지정된 채널에 들어왔을 때
        if (oldState.channelId !== TARGET_CHANNEL_ID && newState.channelId === TARGET_CHANNEL_ID) {
            let connection = getVoiceConnection(newState.guild.id);
            if (!connection) {
                console.log(`'${newState.member.displayName}'님이 '${targetChannel.name}' 채널에 들어와서 나도 접속할게!`);
                connection = joinVoiceChannel({
                    channelId: targetChannel.id,
                    guildId: targetChannel.guild.id,
                    adapterCreator: targetChannel.guild.voiceAdapterCreator,
                    selfDeaf: false,
                });
                
                // 봇이 채널에 접속하면 바로 리스닝 시작
                startListening(connection);
            }
        }
        // 사용자가 지정된 채널에서 나갔을 때
        else if (oldState.channelId === TARGET_CHANNEL_ID && newState.channelId !== TARGET_CHANNEL_ID) {
            // 채널에 봇 외에 다른 사용자가 아무도 없는지 확인
            const humanMembers = oldState.channel.members.filter(member => !member.user.bot);
            if (humanMembers.size === 0) {
                const connection = getVoiceConnection(oldState.guild.id);
                if (connection) {
                    console.log(`'${targetChannel.name}' 채널에 아무도 없어서 나갈게... 😢`);
                    connection.destroy();
                }
            }
        }
    },
};
