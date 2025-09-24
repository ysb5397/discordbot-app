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
            
            // 1. 모델과 챗 세션을 미리 준비하는 건 동일해.
            const model = ai.getGenerativeModel({ 
                model: modelName,
                systemInstruction: "너는 음성으로 대화하는 AI 비서야. 답변은 항상 대화처럼 유연하게 해줘.",
            });
            const chat = model.startChat({ history: [] });

            // 2. 사용자가 말을 끝내면 실행될 로직을 설정.
            const opusStream = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1200 } });
            const pcmStream = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
            const ffmpegProcess = ffmpeg(pcmStream)
                .inputFormat('s16le').inputOptions(['-ar 48000', '-ac 1'])
                .outputFormat('s16le').outputOptions(['-ar 16000', '-ac 1'])
                .on('error', (err) => console.error('FFmpeg 오류:', err));

            let audioChunks = [];
            ffmpegProcess.stream().on('data', (chunk) => {
                audioChunks.push(chunk);
            });

            // 3. 사용자의 말이 끝나면! 모든 일이 시작돼.
            opusStream.on('end', async () => {
                if (audioChunks.length === 0) return; // 아무 말도 안 했으면 무시

                console.log('사용자 음성 스트림이 종료되어 Gemini에게 전송 및 응답 대기를 시작합니다.');
                const audioBuffer = Buffer.concat(audioChunks);
                audioChunks = []; // 메모리 정리를 위해 바로 비워주기

                // 4. 여기서 사용자의 목소리를 보내고, 동시에 응답 스트림을 받아!
                const result = await chat.sendMessageStream([
                    { inlineData: { mimeType: "audio/pcm;rate=16000", data: audioBuffer.toString('base64') } }
                ]);

                // 5. 이제부터 들어올 Gemini의 오디오를 재생할 준비.
                const geminiAudioStream = new Readable({ read() {} });
                const resource = createAudioResource(geminiAudioStream);
                connection.subscribe(player);
                player.play(resource);

                // 6. 스트림으로 들어오는 Gemini의 음성 데이터를 처리.
                for await (const chunk of result.stream) {
                    const audioData = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                    if (audioData) {
                        geminiAudioStream.push(Buffer.from(audioData, 'base64'));
                    }
                }
                // Gemini의 응답이 모두 끝나면 스트림과 세션을 종료.
                geminiAudioStream.push(null);
            });

            // TTS 재생 상태를 관리하는 리스너
            player.on('stateChange', (oldState, newState) => {
                if (newState.status === AudioPlayerStatus.Playing) isBotSpeaking = true;
                else if (newState.status === AudioPlayerStatus.Idle) {
                    console.log('TTS 재생 완료. 다시 들을 준비 완료.');
                    isBotSpeaking = false;
                }
            });

        } catch (error) {
            console.error("Live API 세션 시작 중 오류:", error);
            isBotSpeaking = false;
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
