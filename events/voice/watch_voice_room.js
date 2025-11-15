const { Events } = require('discord.js');
const GeminiVoiceManager = require('../../utils/voice_helper.js');
const YoutubeManager = require('../../utils/youtube_helper.js');

const GEMINI_CHANNEL_ID = "1436212310623518730";
const YOUTUBE_CHANNEL_ID = "1438827978065707059";


module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        const client = newState.client || oldState.client;
        
        if (!client.voiceManagers) {
            client.voiceManagers = new Map();
        }
        const activeManagers = client.voiceManagers;

        if (client.amIActive === false) {
            return;
        }

        if (newState.member.user.bot) return;

        const channelIdJoined = newState.channelId;
        const channelIdLeft = oldState.channelId;
        const member = newState.member;

        // --- 1. 유저가 새 채널에 "입장" 또는 "이동"했을 때 ---
        if (channelIdJoined && channelIdJoined !== channelIdLeft) {
            
            // 봇이 이미 해당 채널에 대한 매니저를 갖고 있다면 (즉, 이미 누군가 있어서 봇이 있다면)
            // 그냥 유저가 추가로 입장한 것이므로 무시.
            if (activeManagers.has(channelIdJoined)) {
                console.log(`[Voice Event] ${member.displayName}님이 이미 봇이 활성화된 채널(${channelIdJoined})에 입장했습니다.`);
                return;
            }

            let newManager = null;
            let channelType = null;

            try {
                // (A) "Gemini" 채널에 입장했는지 확인
                if (channelIdJoined === GEMINI_CHANNEL_ID) {
                    console.log(`[Voice Event] '${member.displayName}'님이 'Gemini' 채널에 입장했습니다. GeminiVoiceManager 생성을 시작합니다.`);
                    const targetChannel = await client.channels.fetch(GEMINI_CHANNEL_ID);
                    newManager = new GeminiVoiceManager(targetChannel);
                    channelType = 'Gemini';
                }
                
                // (B) "YouTube" 채널에 입장했는지 확인
                else if (channelIdJoined === YOUTUBE_CHANNEL_ID) {
                    console.log(`[Voice Event] '${member.displayName}'님이 'YouTube' 채널 입장 -> YoutubeManager 생성.`);
                    
                    const targetChannel = await client.channels.fetch(YOUTUBE_CHANNEL_ID);
                    newManager = new YoutubeManager(targetChannel);
                    channelType = 'YouTube';
                }

                // (C) 관리 대상 채널에 대해 매니저가 성공적으로 생성되었다면
                if (newManager && channelType) {
                    activeManagers.set(channelIdJoined, newManager);
                    await newManager.join();
                    console.log(`[Voice Event] ✅ ${channelType} 매니저가 채널(${channelIdJoined})에 성공적으로 입장했습니다.`);
                }

            } catch (error) {
                console.error(`[Voice Event] ❌ 채널(${channelIdJoined}) 입장 처리 중 심각한 오류 발생:`, error);
                if (activeManagers.has(channelIdJoined)) {
                    activeManagers.delete(channelIdJoined);
                }
            }
        }
        
        // --- 2. 유저가 채널에서 "퇴장" 또는 "이동"했을 때 ---
        // (떠난 채널이 우리가 관리하던 채널 중 하나인지 확인)
        if (channelIdLeft && (channelIdLeft === GEMINI_CHANNEL_ID || channelIdLeft === YOUTUBE_CHANNEL_ID)) {
            
            // 봇 매니저가 해당 채널에서 활성 상태가 아니었다면 (즉, 봇이 없는 채널이었다면)
            // 유저만 나간 거니까 무시.
            if (!activeManagers.has(channelIdLeft)) {
                return;
            }

            console.log(`[Voice Event] '${oldState.member.displayName}'님이 관리 중인 채널(${channelIdLeft})에서 상태를 변경했습니다. 채널 인원수를 확인합니다.`);
            
            try {
                // (중요) 채널 정보를 다시 가져와서 최신 상태 확인
                const channel = await oldState.guild.channels.fetch(channelIdLeft);
                
                // 봇을 제외한 "사람" 유저가 몇 명인지 확인
                const humanMembers = channel.members.filter(m => !m.user.bot);
                console.log(`[Voice Event] 현재 채널(${channelIdLeft})의 (봇 제외) 유저 수: ${humanMembers.size}명`);
                
                // (D) 채널에 봇 외에 아무도 없다면 봇도 퇴장
                if (humanMembers.size === 0) {
                    console.log(`[Voice Event] 채널(${channelIdLeft})에 유저가 없으므로 VoiceManager를 제거하고 퇴장합니다.`);
                    const manager = activeManagers.get(channelIdLeft);
                    
                    if (manager) {
                        manager.destroy(); // 매니저의 자체 정리 및 퇴장 메서드 호출
                        activeManagers.delete(channelIdLeft); // Map에서 제거
                        console.log(`[Voice Event] ✅ 채널(${channelIdLeft})의 매니저를 제거하고 성공적으로 퇴장했습니다.`);
                    }
                }
            } catch (error) {
                // 채널이 삭제되었거나 접근 권한이 없는 등 예외 처리
                if (error.code === 10003) {
                    console.warn(`[Voice Event] 채널(${channelIdLeft})을 찾을 수 없어 매니저를 강제 제거합니다.`);
                    if (activeManagers.has(channelIdLeft)) {
                         activeManagers.get(channelIdLeft).destroy();
                         activeManagers.delete(channelIdLeft);
                    }
                } else {
                    console.error("[Voice Event] ❌ 채널 상태 확인 및 퇴장 처리 중 오류:", error);
                }
            }
        }
    },
};