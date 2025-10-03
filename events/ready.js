const { Events, ChannelType } = require('discord.js');
const { startEarthquakeMonitor } = require('../utils/earthquake');
const { startStatusUpdater } = require('../utils/bot_message.js');
const { joinVoiceChannel } = require('@discordjs/voice');

const TARGET_CHANNEL_ID = "1353292092016693282";

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Logged in as ${client.user.tag}.`);
        console.log('Bot is ready and background tasks are starting.');

        // 지진 정보 모니터링 시작 (내부 스케줄러 사용)
        startEarthquakeMonitor(client);

        // 봇 상태 메시지 업데이트 시작
        startStatusUpdater(client);

        const targetChannel = await client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
        if (targetChannel && targetChannel.type === ChannelType.GuildVoice) {
            const humanMembers = targetChannel.members.filter(member => !member.user.bot);
            if (humanMembers.size > 0) {
                console.log(`'${targetChannel.name}' 채널에 이미 유저가 있어서 접속할게!`);
                joinVoiceChannel({
                    channelId: targetChannel.id,
                    guildId: targetChannel.guild.id,
                    adapterCreator: targetChannel.guild.voiceAdapterCreator,
                });
            }
        }
    },
};