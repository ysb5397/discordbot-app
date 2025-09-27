const { Events } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, EndBehaviorType, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const prism = require('prism-media');
const { GoogleGenAI, Modality } = require('@google/genai');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { Interaction } = require('../../utils/database');
const { generateMongoFilter } = require('../../utils/aiHelper.js');

const ai = new GoogleGenAI({ apiKey: process.env.GENAI_API_KEY });
const modelName = "gemini-2.5-flash-native-audio-preview-09-2025";
const TARGET_CHANNEL_ID = "1353292092016693282";

let isBotSpeaking = false;
let activeSessionUserId = null;

// 사용자의 음성을 텍스트로 변환하는 함수
async function getTranscript(audioBuffer) {
    try {
        const model = ai.models.get({ model: "gemini-2.5-pro" });
        const audioPart = { inlineData: { data: audioBuffer.toString('base64'), mimeType: "audio/pcm;rate=16000" } };
        const result = await model.generateContent({ contents: [{ parts: [{ text: "Transcribe this audio in Korean." }, audioPart] }] });
        return result.response.text();
    } catch (error) {
        console.error("음성 텍스트 변환 중 오류:", error);
        return null;
    }
}

async function setupLiveListeners(connection) {
    console.log("음성 감지 리스너를 활성화합니다.");
    ffmpeg.setFfmpegPath(ffmpegStatic);

    connection.receiver.speaking.on('start', async (userId) => {
        if (isBotSpeaking || (activeSessionUserId && activeSessionUserId !== userId) || (activeSessionUserId === userId)) return;

        activeSessionUserId = userId;
        console.log(`[${userId}] 님이 말을 시작했습니다. 음성 녹음을 시작합니다.`);

        try {
            const player = createAudioPlayer();
            let session = null;

            const opusStream = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1200 } });
            const pcmStream = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
            opusStream.pipe(pcmStream);
            
            const ffmpegProcess = ffmpeg(pcmStream)
                .inputFormat('s16le').inputOptions(['-ar 48000', '-ac 1'])
                .outputFormat('s16le').outputOptions(['-ar 16000', '-ac 1'])
                .on('error', (err) => { console.error(`[${userId}] FFmpeg 처리 중 오류 발생:`, err); activeSessionUserId = null; });

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
    
                    console.log(`[${userId}] 님의 음성을 텍스트로 변환합니다...`);
                    const userTranscript = await getTranscript(audioBuffer);

                    if (!userTranscript) {
                        console.log("음성 인식에 실패하여 대화를 이어갈 수 없습니다.");
                        activeSessionUserId = null;
                        return;
                    }
                    console.log(`[${userId}] 인식된 텍스트: "${userTranscript}"`);

                    let searchResults = [];
                    try {
                        const filter = await generateMongoFilter(userTranscript, userId);
                        searchResults = await Interaction.find(filter).limit(3);
                        if(searchResults.length > 0) console.log(`DB에서 ${searchResults.length}개의 관련 기억을 찾았습니다.`);
                    } catch (error) {
                        console.error("음성 대화 중 기억 검색 실패:", error);
                    }

                    let finalPrompt = `The user just said: "${userTranscript}".`;
                    if (searchResults.length > 0) {
                        const memories = searchResults.map((r, i) => `Memory ${i+1}: ${r.content}`).join('\n');
                        finalPrompt += `\nI found these related past memories:\n${memories}\nPlease use this context in your response.`;
                    }
                    finalPrompt += "\nNow, provide a helpful and friendly audio response in Korean.";

                    console.log("최종 프롬프트를 바탕으로 AI 음성 답변을 요청합니다...");

                    const responseQueue = [];
                    const waitMessage = () => new Promise(resolve => {
                        const check = () => {
                            const msg = responseQueue.shift();
                            if (msg) resolve(msg); else setTimeout(check, 100);
                        }; check();
                    });
                    const handleTurn = async () => {
                        const turns = [];
                        while (true) {
                            const message = await waitMessage();
                            turns.push(message);
                            if (message.serverContent && message.serverContent.turnComplete) return turns;
                        }
                    };

                    session = await ai.live.connect({
                        model: modelName,
                        callbacks: { onmessage: (m) => responseQueue.push(m), onerror: (e) => console.error('Live API Error:', e.message), onclose: (e) => console.log('Live API Close:', e.reason) },
                        config: { responseModalities: [Modality.AUDIO, Modality.TEXT], systemInstruction: finalPrompt },
                    });

                    const turns = await handleTurn();
                    const audioBuffers = turns.map(t => t.data ? Buffer.from(t.data, 'base64') : null).filter(Boolean);
                    const aiTranscript = turns.map(t => t.text).filter(Boolean).join(' ');

                    if (aiTranscript) {
                        const user = await connection.client.users.fetch(userId);
                        const newVoiceInteraction = new Interaction({ interactionId: `${userId}-${Date.now()}`, channelId: connection.joinConfig.channelId, userId, userName: user.username, type: 'VOICE', content: userTranscript, botResponse: aiTranscript });
                        await newVoiceInteraction.save();
                        console.log(`[${userId}] 님의 음성 대화를 DB에 저장했습니다.`);
                    }

                    if (audioBuffers.length > 0) {
                        const combinedAudioBuffer = Buffer.concat(audioBuffers);
                        const inputAudioStream = Readable.from(combinedAudioBuffer);
                        const ffmpegOutput = ffmpeg(inputAudioStream).inputFormat('s16le').inputOptions(['-ar 16000', '-ac 1']).outputFormat('s16le').outputOptions(['-ar 48000', '-ac 1']).on('error', console.error).stream();
                        const resource = createAudioResource(ffmpegOutput, { inputType: StreamType.Raw });
                        connection.subscribe(player);
                        player.play(resource);
                    } else {
                        console.log("Gemini로부터 받은 오디오 데이터가 없습니다.");
                        isBotSpeaking = false; activeSessionUserId = null; if (session) session.close();
                    }

                } catch (error) {
                    console.error(`[${userId}] Gemini 응답 처리 중 심각한 오류 발생:`, error);
                    activeSessionUserId = null; if (session) session.close();
                }
            });

            player.on('stateChange', (oldState, newState) => {
                if (newState.status === AudioPlayerStatus.Playing) isBotSpeaking = true;
                else if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
                    console.log('봇의 TTS 재생이 완료되었습니다.');
                    isBotSpeaking = false; activeSessionUserId = null; if (session) session.close();
                }
            });

        } catch (error) {
            console.error(`[${userId}] 음성 처리 세션 시작 중 오류 발생:`, error);
            isBotSpeaking = false; activeSessionUserId = null;
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
                const newConnection = joinVoiceChannel({ channelId: targetChannel.id, guildId: targetChannel.guild.id, adapterCreator: targetChannel.guild.voiceAdapterCreator, selfDeaf: false });
                setupLiveListeners(newConnection);
            } catch (error) {
                console.error("음성 채널 참가 또는 리스너 설정 중 오류:", error);
            }
        } else if (oldState.channelId === TARGET_CHANNEL_ID && connection) {
            try {
                const channel = await oldState.guild.channels.fetch(oldState.channelId);
                if (channel.members.filter(m => !m.user.bot).size === 0) {
                    console.log(`'${channel.name}' 채널에 아무도 없어 봇이 퇴장합니다.`);
                    connection.destroy(); isBotSpeaking = false; activeSessionUserId = null;
                }
            } catch (error) {
                console.error("채널 상태 확인 또는 퇴장 중 오류:", error);
            }
        }
    },
};
