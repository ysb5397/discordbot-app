const { Events, SpeakingMap } = require('discord.js');
const { getVoiceConnection, EndBehaviorType, createAudioPlayer, createAudioResource, NoSubscriberBehavior, AudioPlayerStatus } = require('@discordjs/voice');
const prism = require('prism-media');
const speech = require('@google-cloud/speech');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const textToSpeech = require('@google-cloud/text-to-speech');
const { Readable } = require('stream');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const credentials = JSON.parse(process.env.DISCORD_CREDENTIALS_JSON);
const speechClient = new speech.SpeechClient({ credentials });
const ttsClient = new textToSpeech.TextToSpeechClient({ credentials });

let isListening = false;

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot || message.content !== '!참가') return;

        const member = message.member;
        if (!member?.voice.channel) {
            return message.reply('음성 채널에 먼저 들어가 있어야 해! 😥');
        }

        const channel = member.voice.channel;
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
        });

        message.reply(`'${channel.name}' 채널에 참가했어. 이제부터는 말만 하면 내가 들을게! 🤫`);

        connection.receiver.speaking.on('start', (userId) => {
            if (isListening) return;
            isListening = true;

            console.log(`${userId} 님이 말을 시작했습니다. STT 스트림을 엽니다.`);
            
            const recognizeStream = speechClient.streamingRecognize({
                config: {
                    encoding: 'LINEAR16',
                    sampleRateHertz: 48000,
                    languageCode: 'ko-KR',
                },
                interimResults: false,
            })
            .on('error', (err) => {
                console.error('STT 스트림 오류:', err);
                isListening = false;
            })
            .on('data', async data => {
                const transcript = data.results[0]?.alternatives[0]?.transcript;
                if (transcript) {
                    console.log(`[STT 결과] ${transcript}`);
                    
                    try {
                        const systemInstruction = "너는 음성으로 대화하는 AI 비서야. 답변은 항상 마크다운이나 특수기호 없이, 실제 대화처럼 해줘.";
                        const result = await model.generateContent([systemInstruction, transcript]);
                        const response = await result.response;
                        const text = response.text();
                        console.log(`[Gemini 답변] ${text}`);

                        const [ttsResponse] = await ttsClient.synthesizeSpeech({
                            input: { text: text },
                            voice: {
                                languageCode: 'ko-KR',
                                name: 'ko-KR-Chirp3-HD-Sulafat'
                            },
                            audioConfig: { audioEncoding: 'MP3' },
                        });

                        const audioBuffer = ttsResponse.audioContent;
                        const ttsAudioStream = new Readable({
                            read() {
                                this.push(audioBuffer);
                                this.push(null);
                            }
                        });
                        const audioResource = createAudioResource(ttsAudioStream);
                        const player = createAudioPlayer();

                        connection.subscribe(player);
                        player.play(audioResource);

                        player.on(AudioPlayerStatus.Idle, () => {
                            console.log('대답이 끝났습니다. 다시 들을 준비 완료.');
                            isListening = false;
                        });

                    } catch (error) {
                        console.error("최종 단계에서 오류 발생:", error);
                        isListening = false;
                    }
                }
            });

            const audioStream = connection.receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: 1500,
                },
            });
            
            const pcmStream = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
            audioStream.pipe(pcmStream).pipe(recognizeStream);
        });
    },
};