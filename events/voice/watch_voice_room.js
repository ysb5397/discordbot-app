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
            try {
                const targetChannel = await newState.client.channels.fetch(TARGET_CHANNEL_ID);
                const manager = new VoiceManager(targetChannel);
                voiceManagers.set(TARGET_CHANNEL_ID, manager);
                await manager.join();
            } catch (error) {
                console.error("VoiceManager 생성 및 채널 참가 중 오류:", error);
            }
        }
        
        // --- 유저가 타겟 채널에서 나갔을 때 ---
        else if (oldState.channelId === TARGET_CHANNEL_ID) {
            try {
                const channel = await oldState.guild.channels.fetch(oldState.channelId);
                // 채널에 봇을 제외한 유저가 아무도 없으면
                if (channel.members.filter(m => !m.user.bot).size === 0) {
                    const manager = voiceManagers.get(TARGET_CHANNEL_ID);
                    if (manager) {
                        manager.destroy();
                        voiceManagers.delete(TARGET_CHANNEL_ID);
                    }
                }
            } catch (error) {
                console.error("채널 상태 확인 및 퇴장 처리 중 오류:", error);
            }
        }
    },
};