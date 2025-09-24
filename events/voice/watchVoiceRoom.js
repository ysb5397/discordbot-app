const { Events, ChannelType } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, EndBehaviorType, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const prism = require('prism-media');
const { GoogleGenAI, Modality } = require('@google/genai');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

// --- 클라이언트 및 설정 초기화 ---
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);
const modelName = "gemini-2.5-flash-native-audio-preview-09-2025";
const TARGET_CHANNEL_ID = "1353292092016693282";

let isBotSpeaking = false;
let currentSession = null;

// --- 상시 듣기 기능 함수 ---
async function setupLiveListeners(connection) {
    console.log("Live API 상시 듣기 모드를 활성화합니다.");
    ffmpeg.setFfmpegPath(ffmpegStatic);

    connection.receiver.speaking.on('start', async (userId) => {
        if (isBotSpeaking || currentSession) return;

        console.log(`${userId} 님이 말을 시작했습니다. Gemini Live 세션을 엽니다.`);

        try {
            const player = createAudioPlayer();
            const geminiAudioStream = new Readable({ read() {} });

            console.log('Gemini Live 세션 연결을 시도합니다...');
            const session = await ai.live.connect({
                model: modelName,
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: "너는 음성으로 대화하는 AI 비서야. 답변은 항상 대화처럼 유연하게 해줘.",
                },
                callbacks: {
                    onmessage: (message) => {
                        console.log("Gemini로부터 메시지 받음:", message);
                        if (message.data) {
                            console.log("오디오 데이터 수신! 크기:", message.data.length);
                            geminiAudioStream.push(Buffer.from(message.data, 'base64'));
                        }
                        if (message.serverContent?.turnComplete) {
                            console.log("Gemini의 응답 턴이 종료되었습니다.");
                            geminiAudioStream.push(null);
                        }
                    },
                    onerror: (e) => console.error('Live API 세션 오류:', e.message),
                    onclose: () => console.log('Live API 세션이 닫혔습니다.'),
                }
            });
            console.log('Gemini Live 세션 연결 성공!');
            currentSession = session;
            
            connection.subscribe(player);
            const resource = createAudioResource(geminiAudioStream);
            player.play(resource);

            player.on('stateChange', (oldState, newState) => {
                if (newState.status === AudioPlayerStatus.Playing) isBotSpeaking = true;
                else if (newState.status === AudioPlayerStatus.Idle) {
                    console.log('TTS 재생 완료. 다시 들을 준비 완료.');
                    isBotSpeaking = false;
                }
            });

            const opusStream = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1200 } });
            const pcmStream = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
            
            const ffmpegProcess = ffmpeg(pcmStream)
                .inputFormat('s16le').inputOptions(['-ar 48000', '-ac 1'])
                .outputFormat('s16le').outputOptions(['-ar 16000', '-ac 1'])
                .on('error', (err) => console.error('FFmpeg 오류:', err));

            ffmpegProcess.stream().on('data', (chunk) => {
                const base64Audio = chunk.toString('base64');
                if (session && !session.isClosed) {
                    session.sendRealtimeInput({ audio: { data: base64Audio, mimeType: "audio/pcm;rate=16000" } });
                }
            });

            opusStream.on('end', () => {
                console.log('사용자 음성 스트림이 종료되어 세션을 닫습니다.');
                if (session && !session.isClosed) session.close();
                currentSession = null;
            });

        } catch (error) {
            console.error("Live API 세션 시작 중 오류:", error);
            isBotSpeaking = false;
            currentSession = null;
        }
    });
}

// --- 메인 이벤트 핸들러 ---
module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        if (newState.member.user.bot) return;

        const connection = getVoiceConnection(newState.guild.id);

        if (newState.channelId === TARGET_CHANNEL_ID && !connection) {
            const targetChannel = await newState.client.channels.fetch(TARGET_CHANNEL_ID);
            console.log(`사용자가 '${targetChannel.name}' 채널에 입장하여 봇이 참가합니다.`);
            const newConnection = joinVoiceChannel({
                channelId: targetChannel.id,
                guildId: targetChannel.guild.id,
                adapterCreator: targetChannel.guild.voiceAdapterCreator,
                selfDeaf: false,
            });
            setupLiveListeners(newConnection);
        }

        if (oldState.channelId === TARGET_CHANNEL_ID && connection) {
            const channel = await oldState.guild.channels.fetch(oldState.channelId);
            if (channel.members.filter(m => !m.user.bot).size === 0) {
                console.log(`'${channel.name}' 채널에 아무도 없어 봇이 퇴장합니다.`);
                connection.destroy();
            }
        }
    },
};
