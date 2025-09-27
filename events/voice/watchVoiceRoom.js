const { Events, ChannelType } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, EndBehaviorType, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const prism = require('prism-media');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

// --- 클라이언트 및 설정 초기화 ---
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const modelName = "gemini-2.5-flash-native-audio-preview-09-2025";
const TARGET_CHANNEL_ID = "1353292092016693282";

let isBotSpeaking = false;
// 동시성 문제를 해결하기 위해 현재 처리 중인 사용자를 기록하는 변수
let activeSessionUserId = null;

// --- 상시 듣기 기능 함수 ---
async function setupLiveListeners(connection) {
    console.log("음성 감지 리스너를 활성화합니다.");
    ffmpeg.setFfmpegPath(ffmpegStatic);

    connection.receiver.speaking.on('start', async (userId) => {
        // 봇이 말하고 있거나, 다른 사용자의 음성을 이미 처리 중이면 무시
        if (isBotSpeaking || activeSessionUserId) {
            if(activeSessionUserId) console.log(`[${userId}] 님이 말을 시작했지만, 현재 [${activeSessionUserId}] 님의 음성을 처리 중이라 무시합니다.`);
            return;
        }

        // 현재 사용자의 음성을 처리하기 시작했다고 기록
        activeSessionUserId = userId;
        console.log(`[${userId}] 님이 말을 시작했습니다. 음성 녹음을 시작합니다.`);

        try {
            const player = createAudioPlayer();
            
            const model = ai.getGenerativeModel({ 
                model: modelName,
                systemInstruction: "너는 음성으로 대화하는 AI 비서야. 답변은 항상 대화처럼 유연하게 해줘.",
            });
            const chat = model.startChat({ history: [] });

            // 사용자가 말을 끝내면 실행될 로직을 설정 (1.2초 침묵 감지)
            const opusStream = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1200 } });
            
            // Discord의 Opus 오디오를 PCM으로 디코딩 -> Gemini가 요구하는 형식으로 변환
            const pcmStream = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
            const ffmpegProcess = ffmpeg(pcmStream)
                .inputFormat('s16le').inputOptions(['-ar 48000', '-ac 1']) // 입력: 48kHz, 1채널 PCM
                .outputFormat('s16le').outputOptions(['-ar 16000', '-ac 1']) // 출력: 16kHz, 1채널 PCM
                .on('error', (err) => {
                    console.error(`[${userId}] FFmpeg 처리 중 오류 발생:`, err);
                    activeSessionUserId = null; // 오류 발생 시 세션 초기화
                });

            let audioChunks = [];
            ffmpegProcess.stream().on('data', (chunk) => {
                audioChunks.push(chunk);
            });

            // 사용자의 말이 끝나면 모든 작업이 시작됨
            opusStream.on('end', async () => {
                // on('end') 콜백 내부의 비동기 로직을 별도의 try-catch로 감싸 안정성 확보
                try {
                    if (audioChunks.length === 0) {
                        console.log(`[${userId}] 님의 음성이 감지되었지만, 데이터가 없어 처리를 건너뜁니다.`);
                        activeSessionUserId = null; // 세션 초기화
                        return;
                    }
    
                    const audioBuffer = Buffer.concat(audioChunks);
                    audioChunks = []; // 메모리 정리를 위해 즉시 비우기
    
                    console.log(`[${userId}] 님의 음성 스트림 종료. 오디오 버퍼 크기: ${audioBuffer.length}. Gemini에게 전송을 시작합니다.`);
    
                    // 사용자의 목소리를 보내고, 동시에 응답 스트림을 받음
                    const result = await chat.sendMessageStream([
                        { inlineData: { mimeType: "audio/pcm;rate=16000", data: audioBuffer.toString('base64') } }
                    ]);
    
                    console.log(`[${userId}] 님의 요청에 대한 Gemini 응답 스트림 수신을 시작합니다.`);
    
                    // Gemini의 오디오를 재생할 스트림과 리소스 준비
                    const geminiAudioStream = new Readable({ read() {} });
                    const resource = createAudioResource(geminiAudioStream);
                    connection.subscribe(player);
                    player.play(resource);
    
                    // 스트림으로 들어오는 Gemini의 음성 데이터를 처리
                    for await (const chunk of result.stream) {
                        const audioData = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                        if (audioData) {
                            geminiAudioStream.push(Buffer.from(audioData, 'base64'));
                        } else {
                            // 오디오 데이터가 없는 응답은 디버깅을 위해 로그로 남김
                            console.log(`[DEBUG] 오디오 데이터가 없는 응답 청크:`, JSON.stringify(chunk));
                        }
                    }
    
                    // Gemini의 응답이 모두 끝나면 스트림 종료 신호를 보냄
                    console.log(`[${userId}] 님의 요청에 대한 Gemini 응답 스트림 수신 완료.`);
                    geminiAudioStream.push(null);

                } catch (error) {
                    console.error(`[${userId}] Gemini 응답 처리 중 심각한 오류 발생:`, error);
                    activeSessionUserId = null; // 오류 발생 시 세션 초기화
                }
            });

            // TTS 재생 상태를 관리하는 리스너
            player.on('stateChange', (oldState, newState) => {
                if (oldState.status !== AudioPlayerStatus.Playing && newState.status === AudioPlayerStatus.Playing) {
                    console.log('봇의 TTS 재생이 시작되었습니다.');
                    isBotSpeaking = true;
                } else if (oldState.status !== AudioPlayerStatus.Idle && newState.status === AudioPlayerStatus.Idle) {
                    console.log('봇의 TTS 재생이 완료되었습니다. 다시 들을 준비가 되었습니다.');
                    isBotSpeaking = false;
                    activeSessionUserId = null; // 봇의 말이 끝나면 세션 초기화
                }
            });

        } catch (error) {
            console.error(`[${userId}] 음성 처리 세션 시작 중 오류 발생:`, error);
            isBotSpeaking = false;
            activeSessionUserId = null; // 어떤 오류든 발생하면 세션을 반드시 초기화
        }
    });
}

// --- 메인 이벤트 핸들러 ---
module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        if (newState.member.user.bot) return;

        const connection = getVoiceConnection(newState.guild.id);

        // 사용자가 지정된 채널에 들어왔고, 봇이 아직 없다면 참가
        if (newState.channelId === TARGET_CHANNEL_ID && !connection) {
            try {
                const targetChannel = await newState.client.channels.fetch(TARGET_CHANNEL_ID);
                console.log(`사용자가 '${targetChannel.name}' 채널에 입장하여 봇이 참가합니다.`);
                const newConnection = joinVoiceChannel({
                    channelId: targetChannel.id,
                    guildId: targetChannel.guild.id,
                    adapterCreator: targetChannel.guild.voiceAdapterCreator,
                    selfDeaf: false,
                });
                setupLiveListeners(newConnection);
            } catch (error) {
                console.error("음성 채널 참가 또는 리스너 설정 중 오류:", error);
            }
        }

        // 사용자가 지정된 채널을 나갔을 때, 채널에 봇 외에 아무도 없으면 퇴장
        if (oldState.channelId === TARGET_CHANNEL_ID && connection) {
            try {
                const channel = await oldState.guild.channels.fetch(oldState.channelId);
                if (channel.members.filter(m => !m.user.bot).size === 0) {
                    console.log(`'${channel.name}' 채널에 아무도 없어 봇이 퇴장합니다.`);
                    connection.destroy();
                    // 변수 상태 초기화
                    isBotSpeaking = false;
                    activeSessionUserId = null;
                }
            } catch (error) {
                console.error("채널 상태 확인 또는 퇴장 중 오류:", error);
            }
        }
    },
};