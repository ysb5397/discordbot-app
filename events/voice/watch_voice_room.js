const { Events } = require('discord.js');
const VoiceManager = require('../../utils/voice_helper.js');

const TARGET_CHANNEL_ID = "1353292092016693282";
const voiceManagers = new Map();

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        if (newState.member.user.bot) return;

        // --- 유저가 타겟 채널에 들어왔을 때 ---
        if (newState.channelId === TARGET_CHANNEL_ID && !voiceManagers.has(TARGET_CHANNEL_ID)) {
            console.log(`[Voice Event] '${newState.member.displayName}'님이 타겟 채널에 입장했습니다. VoiceManager 생성을 시작합니다.`);
            try {
                const targetChannel = await newState.client.channels.fetch(TARGET_CHANNEL_ID);
                const manager = new VoiceManager(targetChannel);
                voiceManagers.set(TARGET_CHANNEL_ID, manager);
                await manager.join();
            } catch (error) {
                console.error("[Voice Event] ❌ VoiceManager 생성 및 채널 참가 중 오류:", error);
            }
        }
        
        // --- 유저가 타겟 채널에서 나갔을 때 ---
        else if (oldState.channelId === TARGET_CHANNEL_ID) {
            console.log(`[Voice Event] '${oldState.member.displayName}'님이 채널 상태를 변경했습니다. 채널 인원수를 확인합니다.`);
            try {
                const channel = await oldState.guild.channels.fetch(oldState.channelId);
                const humanMembers = channel.members.filter(m => !m.user.bot);
                console.log(`[Voice Event] 현재 채널의 유저 수: ${humanMembers.size}명`);
                
                if (humanMembers.size === 0) {
                    console.log("[Voice Event] 채널에 유저가 없으므로 VoiceManager를 제거하고 퇴장합니다.");
                    const manager = voiceManagers.get(TARGET_CHANNEL_ID);
                    if (manager) {
                        manager.destroy();
                        voiceManagers.delete(TARGET_CHANNEL_ID);
                    }
                }
            } catch (error) {
                console.error("[Voice Event] ❌ 채널 상태 확인 및 퇴장 처리 중 오류:", error);
            }
        }
    },
};