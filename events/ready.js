const { Events, ChannelType } = require('discord.js');
const { startEarthquakeMonitor } = require('../utils/earthquake');
const { joinVoiceChannel } = require('@discordjs/voice');

const TARGET_CHANNEL_ID = "1353292092016693282";

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`${client.user.tag}으로 로그인했습니다.`);
        console.log('봇이 준비되었으며 백그라운드 작업을 시작합니다.');

        // 지진 정보 모니터링 시작 (내부 스케줄러 사용)
        startEarthquakeMonitor(client);

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