const { Events } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, EndBehaviorType, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const prism = require('prism-media');
const { GoogleGenerativeAI, Modality } = require('@google/generative-ai');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const modelName = "gemini-2.5-flash-native-audio-preview-09-2025";
const TARGET_CHANNEL_ID = "1353292092016693282";

let isBotSpeaking = false;
let activeSessionUserId = null;

async function setupLiveListeners(connection) {
    console.log("음성 감지 리스너를 활성화합니다.");
    ffmpeg.setFfmpegPath(ffmpegStatic);

    connection.receiver.speaking.on('start', async (userId) => {
        if (isBotSpeaking || activeSessionUserId) {
            if(activeSessionUserId) console.log(`[${userId}] 님이 말을 시작했지만, 현재 [${activeSessionUserId}] 님의 음성을 처리 중이라 무시합니다.`);
            return;
        }

        activeSessionUserId = userId;
        console.log(`[${userId}] 님이 말을 시작했습니다. 음성 녹음을 시작합니다.`);

        try {
            const player = createAudioPlayer();
            const opusStream = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1200 } });
            const pcmStream = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
            opusStream.pipe(pcmStream);
            
            const ffmpegProcess = ffmpeg(pcmStream)
                .inputFormat('s16le').inputOptions(['-ar 48000', '-ac 1'])
                .outputFormat('s16le').outputOptions(['-ar 16000', '-ac 1'])
                .on('error', (err) => {
                    console.error(`[${userId}] FFmpeg 처리 중 오류 발생:`, err);
                    activeSessionUserId = null;
                });

            let audioChunks = [];
            ffmpegProcess.stream().on('data', (chunk) => audioChunks.push(chunk));

            opusStream.on('end', async () => {
                try {
                    if (audioChunks.length === 0) {
                        console.log(`[${userId}] 님의 음성이 감지되었지만, 데이터가 없어 처리를 건너뜁니다.`);
                        activeSessionUserId = null;
                        return;
                    }
    
                    const audioBuffer = Buffer.concat(audioChunks);
                    audioChunks = [];
    
                    console.log(`[${userId}] 님의 음성 스트림 종료. 오디오 버퍼 크기: ${audioBuffer.length}. Gemini Live API에 연결을 시작합니다.`);

                    const responseQueue = [];

                    async function waitMessage() {
                        while (true) {
                            const message = responseQueue.shift();
                            if (message) return message;
                            await new Promise((resolve) => setTimeout(resolve, 100));
                        }
                    }

                    async function handleTurn() {
                        const turns = [];
                        while (true) {
                            const message = await waitMessage();
                            turns.push(message);
                            if (message.serverContent && message.serverContent.turnComplete) {
                                return turns;
                            }
                        }
                    }

                    const session = await ai.live.connect({
                        model: modelName,
                        callbacks: {
                            onmessage: (message) => responseQueue.push(message),
                            onerror: (e) => console.error('Live API Error:', e.message),
                            onclose: (e) => console.log('Live API Close:', e.reason),
                        },
                        config: {
                            responseModalities: [Modality.AUDIO],
                            systemInstruction: "You are a helpful assistant and answer in a friendly tone. Answer in Korean."
                        },
                    });

                    session.sendRealtimeInput({
                        audio: {
                            data: audioBuffer.toString('base64'),
                            mimeType: "audio/pcm;rate=16000"
                        }
                    });

                    const turns = await handleTurn();

                    const combinedAudio = turns.reduce((acc, turn) => {
                        if (turn.data) {
                            const buffer = Buffer.from(turn.data, 'base64');
                            const intArray = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Int16Array.BYTES_PER_ELEMENT);
                            return acc.concat(Array.from(intArray));
                        }
                        return acc;
                    }, []);

                    if (combinedAudio.length > 0) {
                        const audioOutputBuffer = Buffer.from(new Int16Array(combinedAudio).buffer);
                        const readableStream = Readable.from(audioOutputBuffer);
                        const resource = createAudioResource(readableStream);
                        connection.subscribe(player);
                        player.play(resource);
                    } else {
                        console.log("Gemini로부터 받은 오디오 데이터가 없습니다.");
                        isBotSpeaking = false;
                        activeSessionUserId = null;
                    }

                    session.close();

                } catch (error) {
                    console.error(`[${userId}] Gemini 응답 처리 중 심각한 오류 발생:`, error);
                    activeSessionUserId = null;
                }
            });

            player.on('stateChange', (oldState, newState) => {
                if (oldState.status !== AudioPlayerStatus.Playing && newState.status === AudioPlayerStatus.Playing) {
                    console.log('봇의 TTS 재생이 시작되었습니다.');
                    isBotSpeaking = true;
                } else if (oldState.status !== AudioPlayerStatus.Idle && newState.status === AudioPlayerStatus.Idle) {
                    console.log('봇의 TTS 재생이 완료되었습니다. 다시 들을 준비가 되었습니다.');
                    isBotSpeaking = false;
                    activeSessionUserId = null;
                }
            });

        } catch (error) {
            console.error(`[${userId}] 음성 처리 세션 시작 중 오류 발생:`, error);
            isBotSpeaking = false;
            activeSessionUserId = null;
        }
    });
}

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        if (newState.member.user.bot) return;

        const connection = getVoiceConnection(newState.guild.id);

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

        if (oldState.channelId === TARGET_CHANNEL_ID && connection) {
            try {
                const channel = await oldState.guild.channels.fetch(oldState.channelId);
                if (channel.members.filter(m => !m.user.bot).size === 0) {
                    console.log(`'${channel.name}' 채널에 아무도 없어 봇이 퇴장합니다.`);
                    connection.destroy();
                    isBotSpeaking = false;
                    activeSessionUserId = null;
                }
            } catch (error) {
                console.error("채널 상태 확인 또는 퇴장 중 오류:", error);
            }
        }
    },
};