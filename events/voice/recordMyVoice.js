const { Events } = require('discord.js');
const { getVoiceConnection, EndBehaviorType, createAudioPlayer, createAudioResource, NoSubscriberBehavior } = require('@discordjs/voice');
const prism = require('prism-media');

// 1. Google Cloud Speech 클라이언트 라이브러리 추가
const speech = require('@google-cloud/speech');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Gemini 라이브러리 추가

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const textToSpeech = require('@google-cloud/text-to-speech');
const { Readable } = require('stream');

// 2. Google Cloud 인증 설정
// 네가 다운로드한 JSON 키 파일 경로를 정확하게 적어줘야 해!
const credentials = JSON.parse(process.env.DISCORD_CREDENTIALS_JSON);

// 2. keyFilename 대신 credentials 객체를 직접 전달
const speechClient = new speech.SpeechClient({
    credentials,
});

const ttsClient = new textToSpeech.TextToSpeechClient({ credentials });

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot || message.content !== '!녹음시작') return;

        const connection = getVoiceConnection(message.guild.id);
        if (!connection) {
            return message.reply('내가 음성 채널에 먼저 들어가 있어야 해! 😥');
        }
        if (message.member.voice.channel?.id !== connection.joinConfig.channelId) {
            return message.reply('나랑 같은 음성 채널에 있어야 녹음할 수 있어!');
        }

        await message.reply('귀를 기울이고 있어... 말해봐! 🎤');

        // 3. Google STT API로 보낼 실시간 스트림 생성
        const recognizeStream = speechClient
            .streamingRecognize({
                config: {
                    encoding: 'LINEAR16',
                    sampleRateHertz: 48000,
                    languageCode: 'ko-KR',
                },
                interimResults: false, // 중간 결과는 받지 않음
            })
            .on('error', console.error)
            .on('data', async data => {
                const transcript = data.results[0]?.alternatives[0]?.transcript;
                if (transcript) {
                    console.log(`[STT 최종 결과] ${transcript}`);
                    
                    try {
                        // Gemini에게 답변 생성 요청
                        const result = await model.generateContent(transcript);
                        const response = await result.response;
                        const text = response.text();
                        console.log(`[Gemini 답변] ${text}`);

                        // 3. Gemini의 텍스트 답변을 Google TTS로 보내 음성 데이터로 변환
                        const [ttsResponse] = await ttsClient.synthesizeSpeech({
                            input: { text: text },
                            voice: { languageCode: 'ko-KR', ssmlGender: 'FEMALE' },
                            audioConfig: { audioEncoding: 'MP3' },
                        });

                        // 4. 받은 음성 데이터를 디스코드에서 재생 가능한 형태로 변환
                        const audioBuffer = ttsResponse.audioContent;
                        const audioStream = new Readable({
                            read() {
                                this.push(audioBuffer);
                                this.push(null); // 스트림의 끝을 알림
                            }
                        });
                        const audioResource = createAudioResource(audioStream);
                        const player = createAudioPlayer();

                        // 5. 음성 채널에 오디오 플레이어를 연결하고 재생!
                        const connection = getVoiceConnection(message.guild.id);
                        connection.subscribe(player);
                        player.play(audioResource);

                    } catch (error) {
                        console.error("최종 단계에서 오류 발생:", error);
                    }
                }
            });

        // 5. 디스코드에서 사용자의 음성 스트림을 받기
        const audioStream = connection.receiver.subscribe(message.author.id, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: 1500,
            },
        });

        // 6. Opus -> PCM으로 디코딩할 스트림 생성
        const pcmStream = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });

        // 7. 디스코드 음성 스트림을 PCM으로 디코딩한 뒤, Google STT 스트림으로 흘려보내기!
        audioStream.pipe(pcmStream).pipe(recognizeStream);

        // 사용자가 말을 멈춰서 audioStream이 끝나면, Google STT 스트림도 종료
        audioStream.on('end', () => {
            console.log('음성 스트림이 종료되었습니다.');
        });
    },
};