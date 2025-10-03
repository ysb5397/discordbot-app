const { joinVoiceChannel, getVoiceConnection, EndBehaviorType, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const prism = require('prism-media');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { Interaction } = require('./database');
const { getTranscript, getLiveAiAudioResponse, generateMongoFilter } = require('./ai_helper');

// 오디오 설정 상수로 관리
const AUDIO_CONFIG = {
    DISCORD_SAMPLE_RATE: 48000,
    AI_SAMPLE_RATE: 16000,
    CHANNELS: 1,
    FRAME_SIZE: 960,
    FORMAT: 's16le'
};

class VoiceManager {
    constructor(channel) {
        this.channel = channel;
        this.connection = null;
        this.player = createAudioPlayer();
        this.activeSession = null;

        ffmpeg.setFfmpegPath(ffmpegStatic);
        this.#setupPlayerListeners();
    }

    async join() {
        if (this.connection) return;
        try {
            this.connection = joinVoiceChannel({
                channelId: this.channel.id,
                guildId: this.channel.guild.id,
                adapterCreator: this.channel.guild.voiceAdapterCreator,
                selfDeaf: false,
            });
            this.connection.subscribe(this.player);
            this.#startListening();
            console.log(`음성 채널 [${this.channel.name}]에 참가했습니다.`);
        } catch (error) {
            console.error("음성 채널 참가 중 오류:", error);
        }
    }

    destroy() {
        if (!this.connection) return;
        this.connection.destroy();
        this.connection = null;
        this.#endSession();
        console.log(`음성 채널 [${this.channel.name}]에서 퇴장했습니다.`);
    }

    #setupPlayerListeners() {
        this.player.on('stateChange', (oldState, newState) => {
            if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
                console.log('봇의 TTS 재생이 완료되었습니다.');
                this.#endSession();
            }
        });
    }
    
    #startListening() {
        this.connection.receiver.speaking.on('start', (userId) => {
            if (this.activeSession) return;

            this.activeSession = { userId, liveSession: null };
            console.log(`[${userId}] 님이 말을 시작했습니다. 음성 처리를 시작합니다.`);
            this.#processUserSpeech(userId);
        });
    }
    
    async #processUserSpeech(userId) {
        try {
            const userAudioBuffer = await this.#recordUserAudio(userId);
            if (userAudioBuffer.length === 0) {
                console.log("녹음된 오디오가 없어 처리를 중단합니다.");
                return this.#endSession();
            }

            const userTranscript = await getTranscript(userAudioBuffer);
            if (!userTranscript) {
                console.log("음성을 텍스트로 변환하지 못했습니다.");
                return this.#endSession();
            }
            console.log(`인식된 텍스트: "${userTranscript}"`);
            
            const { audioBuffers, aiTranscript, session } = await this.#getAiResponse(userTranscript, userId);
            this.activeSession.liveSession = session;

            await this.#saveInteraction(userId, userTranscript, aiTranscript);

            if (audioBuffers && audioBuffers.length > 0) {
                this.#playAiAudio(audioBuffers);
            } else {
                console.log("AI로부터 받은 오디오 데이터가 없습니다.");
                this.#endSession();
            }
        } catch (error) {
            console.error(`음성 처리 파이프라인 오류:`, error);
            this.#endSession();
        }
    }

    #recordUserAudio(userId) {
        return new Promise((resolve, reject) => {
            const opusStream = this.connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1200 } });
            const pcmStream = new prism.opus.Decoder({ 
                frameSize: AUDIO_CONFIG.FRAME_SIZE, 
                channels: AUDIO_CONFIG.CHANNELS, 
                rate: AUDIO_CONFIG.DISCORD_SAMPLE_RATE 
            });
            
            const ffmpegProcess = ffmpeg(pcmStream)
                .inputFormat(AUDIO_CONFIG.FORMAT).inputOptions([`-ar ${AUDIO_CONFIG.DISCORD_SAMPLE_RATE}`, `-ac ${AUDIO_CONFIG.CHANNELS}`])
                .outputFormat(AUDIO_CONFIG.FORMAT).outputOptions([`-ar ${AUDIO_CONFIG.AI_SAMPLE_RATE}`, `-ac ${AUDIO_CONFIG.CHANNELS}`])
                .on('error', reject);

            const audioChunks = [];
            ffmpegProcess.stream().on('data', chunk => audioChunks.push(chunk));
            opusStream.on('end', () => resolve(Buffer.concat(audioChunks)));
        });
    }

    async #getAiResponse(transcript, userId) {
        const searchResults = await this.#searchMemories(transcript, userId);
        
        let finalPrompt = `The user just said: "${transcript}".`;
        if (searchResults.length > 0) {
            const memories = searchResults.map(r => ` - ${r.content}`).join('\n');
            finalPrompt += `\nI found these related past memories:\n${memories}\nPlease use this context to form your response.`;
        }
        finalPrompt += "\nNow, provide a helpful and friendly audio response in Korean.";

        console.log("최종 프롬프트를 바탕으로 AI 음성 답변을 요청합니다...");
        return getLiveAiAudioResponse(finalPrompt);
    }
    
    async #searchMemories(transcript, userId) {
        try {
            const filter = await generateMongoFilter(transcript, userId);
            const results = await Interaction.find(filter).limit(3);
            if (results.length > 0) console.log(`DB에서 ${results.length}개의 관련 기억을 찾았습니다.`);
            return results;
        } catch (e) {
            console.error("기억 검색 실패:", e);
            return [];
        }
    }

    async #saveInteraction(userId, userTranscript, aiTranscript) {
        if (!aiTranscript) return;
        try {
            const user = await this.channel.client.users.fetch(userId);
            const newInteraction = new Interaction({
                interactionId: `${userId}-${Date.now()}`,
                channelId: this.channel.id,
                userId,
                userName: user.username,
                type: 'VOICE',
                content: userTranscript,
                botResponse: aiTranscript
            });
            await newInteraction.save();
            console.log(`음성 대화를 DB에 저장했습니다.`);
        } catch (error) {
            console.error("DB 저장 실패:", error);
        }
    }

    #playAiAudio(audioBuffers) {
        const combinedBuffer = Buffer.concat(audioBuffers);
        const inputAudioStream = Readable.from(combinedBuffer);

        const ffmpegOutput = ffmpeg(inputAudioStream)
            .inputFormat(AUDIO_CONFIG.FORMAT).inputOptions([`-ar ${AUDIO_CONFIG.AI_SAMPLE_RATE}`, `-ac ${AUDIO_CONFIG.CHANNELS}`])
            .outputFormat(AUDIO_CONFIG.FORMAT).outputOptions([`-ar ${AUDIO_CONFIG.DISCORD_SAMPLE_RATE}`, `-ac ${AUDIO_CONFIG.CHANNELS}`])
            .on('error', console.error)
            .stream();
            
        const resource = createAudioResource(ffmpegOutput, { inputType: StreamType.Raw });
        this.player.play(resource);
    }

    #endSession() {
        if (!this.activeSession) return;
        if (this.activeSession.liveSession) {
            this.activeSession.liveSession.close();
        }
        this.activeSession = null;
        console.log("활성 음성 세션을 종료합니다.");
    }
}

module.exports = VoiceManager;