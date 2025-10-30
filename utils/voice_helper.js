const { joinVoiceChannel, getVoiceConnection, EndBehaviorType, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const prism = require('prism-media');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { Interaction } = require('./database');
const { getTranscript, getLiveAiAudioResponse, generateMongoFilter } = require('./ai_helper');

// (AUDIO_CONFIG는 이전과 동일)
const AUDIO_CONFIG = {
    DISCORD_SAMPLE_RATE: 48000,
    AI_SAMPLE_RATE: 16000,
    AI_OUTPUT_SAMPLE_RATE: 24000,
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
        console.log(`[디버그] VoiceManager 인스턴스가 채널 '${channel.name}'에 대해 생성되었습니다.`);
    }

    async join() {
        if (this.connection) return;
        try {
            console.log(`[디버그] 채널 '${this.channel.name}'에 참가를 시도합니다...`);
            this.connection = joinVoiceChannel({
                channelId: this.channel.id,
                guildId: this.channel.guild.id,
                adapterCreator: this.channel.guild.voiceAdapterCreator,
                selfDeaf: false,
            });
            this.connection.subscribe(this.player);
            this.#startListening();
            console.log(`[디버그] ✅ 음성 채널 [${this.channel.name}]에 성공적으로 참가했습니다.`);
        } catch (error) {
            console.error("[디버그] ❌ 음성 채널 참가 중 심각한 오류 발생:", error);
        }
    }

    destroy() {
        if (!this.connection) return;
        console.log(`[디버그] 채널 '${this.channel.name}'에서 퇴장을 시작합니다.`);
        this.connection.destroy();
        this.connection = null;
        this.#endSession();
        console.log(`[디버그] ✅ 음성 채널 [${this.channel.name}]에서 성공적으로 퇴장했습니다.`);
    }

    #setupPlayerListeners() {
        this.player.on('stateChange', (oldState, newState) => {
            console.log(`[디버그] 오디오 플레이어 상태 변경: ${oldState.status} -> ${newState.status}`);
            if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
                console.log('[디버그] 봇의 TTS 재생이 완료되어 세션을 종료합니다.');
                this.#endSession();
            }
        });
        this.player.on('error', error => {
            console.error('[디버그] ❌ 오디오 플레이어에서 오류 발생:', error);
            console.log('[디버그] 플레이어 오류로 인해 세션을 강제 종료합니다.');
            this.#endSession();
        });
    }
    
    #startListening() {
        console.log('[디버그] 유저 발화 감지(speaking) 리스너를 활성화합니다.');
        this.connection.receiver.speaking.on('start', (userId) => {
            if (this.activeSession) {
                console.log(`[디버그] [${userId}]님이 말을 시작했지만, 이미 다른 세션이 진행 중이라 무시합니다.`);
                return;
            }
            this.activeSession = { userId, liveSession: null };
            console.log(`[디버그] 🎤 [${userId}] 님의 발화가 감지되었습니다. 음성 처리 파이프라인을 시작합니다.`);
            this.#processUserSpeech(userId);
        });
    }
    
    async #processUserSpeech(userId) {
        try {
            console.log(`[디버그] 1. [${userId}]님의 음성 스트림 처리를 시작합니다.`);
            const userAudioStream = this.#recordUserAudio(userId);

            if (!userAudioStream) {
                console.error('[디버그] ❌ #recordUserAudio가 스트림을 반환하지 않아 파이프라인을 중단합니다. (아마도 너무 짧은 발화)');
                this.#endSession();
                return;
            }
            
            console.log(`[디버그] 2. AI 답변 생성을 요청합니다. (이제 STT를 건너뜁니다)`);
            
            const { audioBuffers, aiTranscript, session } = await this.#getAiResponse(userId, userAudioStream);
            this.activeSession.liveSession = session;
            console.log(`[디버그] ✅ 3. AI 답변 생성 완료 (텍스트: "${aiTranscript}", 오디오 버퍼 개수: ${audioBuffers.length}).`);
            
            console.log(`[디버그] 4. 대화 내용을 DB에 저장합니다.`);
            const botResponseToSave = aiTranscript.trim() || `(AI가 ${audioBuffers.length}개의 오디오 버퍼로 응답함)`;
            await this.#saveInteraction(userId, "(User spoke)", botResponseToSave);

            if (audioBuffers && audioBuffers.length > 0) {
                console.log(`[디버그] 5. 생성된 AI 음성을 채널에 재생합니다.`);
                this.#playAiAudio(audioBuffers);
            } else {
                console.log("[디버그] ⚠️ AI로부터 받은 오디오 데이터가 없어 재생할 수 없습니다.");
                this.#endSession();
            }
        } catch (error) {
            console.error(`[디버그] ❌ 음성 처리 파이프라인 전체 과정에서 오류 발생:`, error);
            this.#endSession();
        }
    }

    #recordUserAudio(userId) {
        console.log(`[디버그] -> 녹음: [${userId}]님의 오디오 스트림을 구독합니다.`);
        const opusStream = this.connection.receiver.subscribe(userId, { 
            end: { 
                behavior: EndBehaviorType.Manual // <--- "AfterSilence"를 "Manual"로 변경!
            } 
        });
        
        const pcmStream = new prism.opus.Decoder({ 
            frameSize: AUDIO_CONFIG.FRAME_SIZE, 
            channels: AUDIO_CONFIG.CHANNELS, 
            rate: AUDIO_CONFIG.DISCORD_SAMPLE_RATE 
        });

        opusStream.pipe(pcmStream);

        const ffmpegProcess = ffmpeg(pcmStream)
            .inputFormat(AUDIO_CONFIG.FORMAT)
            .inputOptions([`-ar ${AUDIO_CONFIG.DISCORD_SAMPLE_RATE}`, `-ac ${AUDIO_CONFIG.CHANNELS}`])
            .outputFormat(AUDIO_CONFIG.FORMAT)
            .outputOptions([`-ar ${AUDIO_CONFIG.AI_SAMPLE_RATE}`])
            .on('start', cmd => console.log(`[디버그] -> 녹음: FFmpeg 리샘플링 프로세스 시작.`))
            .on('error', err => {
                console.error('[디버그] ❌ -> 녹음: FFmpeg 오류 발생:', err);
                opusStream.destroy(err);
            });
        
        opusStream.on('end', () => {
            console.log(`[디버그] -> 녹음: Opus 스트림 종료. pcmStream 종료를 알립니다.`);
            pcmStream.end();
        });

        return ffmpegProcess.stream(); 
    }

    async #getAiResponse(transcript, userId, userAudioStream) {
        // ▼▼▼ 기억 검색 로직을 일단 제거 (STT가 없으므로) ▼▼▼
        // console.log(`[디버그] -> AI 응답: 기억 검색을 시작합니다 (임시 쿼리: "${transcript}").`);
        // const searchResults = await this.#searchMemories(transcript, userId);
        
        let systemPrompt = `You are a friendly and helpful AI assistant. Respond in Korean.`;
        // if (searchResults.length > 0) {
        //     const memories = searchResults.map(r => ` - ${r.content}`).join('\n');
        //     systemPrompt += `\nHere are some related past memories to provide context:\n${memories}`;
        //     console.log(`[디버그] -> AI 응답: ${searchResults.length}개의 기억을 찾아 프롬프트에 추가했습니다.`);
        // }
        // ▲▲▲ 기억 검색 로직 제거 ▲▲▲
        
        console.log(`[디버그] -> AI 응답: 최종 프롬프트와 오디오 스트림으로 Gemini Live API를 호출합니다.`);
        return getLiveAiAudioResponse(systemPrompt, userAudioStream);
    }
    
    async #searchMemories(transcript, userId) {
        try {
            const filter = await generateMongoFilter(transcript, userId, this.channel.client);
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

        console.log(`[디버그] -> 재생: AI 오디오(버퍼 크기: ${combinedBuffer.length})를 Discord 샘플링 레이트로 변환합니다.`);
        const ffmpegOutput = ffmpeg(inputAudioStream)
            .inputFormat(AUDIO_CONFIG.FORMAT).inputOptions([`-ar ${AUDIO_CONFIG.AI_OUTPUT_SAMPLE_RATE}`])
            .outputFormat(AUDIO_CONFIG.FORMAT).outputOptions([`-ar ${AUDIO_CONFIG.DISCORD_SAMPLE_RATE}`])
            .on('start', cmd => console.log(`[디버그] -> 재생: FFmpeg 재생 프로세스 시작.`))
            .on('error', err => console.error('[디버그] ❌ -> 재생: FFmpeg 오류:', err))
            .stream();
            
        const resource = createAudioResource(ffmpegOutput, { inputType: StreamType.Raw });
        console.log('[디버그] -> 재생: 오디오 리소스를 생성하여 플레이어에서 재생합니다.');
        this.player.play(resource);
    }

    #endSession() {
        if (!this.activeSession) return;
        console.log(`[디버그] 🌀 [${this.activeSession.userId}]님과의 활성 음성 세션을 종료합니다.`);
        if (this.activeSession.liveSession) {
            console.log('[디버그] -> 세션 종료: Gemini Live API 연결을 닫습니다.');
            this.activeSession.liveSession.close();
        }
        this.activeSession = null;
    }
}

module.exports = VoiceManager;