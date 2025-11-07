const { Events, ChannelType, ActivityType } = require('discord.js');
const { startEarthquakeMonitor } = require('../utils/earthquake');
const { joinVoiceChannel } = require('@discordjs/voice');

const TARGET_CHANNEL_ID = "1353292092016693282";

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`${client.user.tag}으로 로그인했습니다.`);
        console.log('봇이 준비되었으며 백그라운드 작업을 시작합니다.');

        try {
            client.user.setPresence({
                status: 'online', // 'online' (온라인), 'idle' (자리비움), 'dnd' (방해금지)
                activities: [{
                    name: 'Gemini', // <-- 여기에 표시할 게임/활동 이름
                    type: ActivityType.Playing, // Playing (플레이 중), Watching (시청 중), Listening (듣는 중) 등
                    timestamps: { start: Date.now() }, // 경과 시간 표시
                }],
            });
            console.log('봇의 "Playing" 상태 메시지를 성공적으로 설정했습니다.');
        } catch (error) {
            console.error('봇 상태 메시지 설정 중 오류 발생:', error);
        }

        const targetChannel = await client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
        if (targetChannel && targetChannel.type === ChannelType.GuildVoice) {
            const humanMembers = targetChannel.members.filter(member => !member.user.bot);
            if (humanMembers.size > 0) {
                console.log(`'${targetChannel.name}' 채널에 이미 유저가 있어 접속합니다!`);
                joinVoiceChannel({
                    channelId: targetChannel.id,
                    guildId: targetChannel.guild.id,
                    adapterCreator: targetChannel.guild.voiceAdapterCreator,
                });
            }
        }
    },
};