const cron = require('node-cron');
const { SchedulerConfig } = require('./database.js');
const { deepResearch } = require('./ai_helper.js');
const { createAiResponseEmbed } = require('./embed_builder.js');
const { AttachmentBuilder } = require('discord.js');

let briefingTask = null;

/**
 * DB 설정을 읽어서 시작하는 함수
 */
async function reloadBriefingSchedule(client) {
    if (briefingTask) {
        briefingTask.stop();
        briefingTask = null;
    }

    try {
        const configData = await SchedulerConfig.findOne({ type: 'BRIEFING', isActive: true });
        
        if (!configData || !configData.scheduleValue) {
            console.log('[Briefing] 활성화된 브리핑 일정이 없습니다.');
            return;
        }

        const [hour, minute] = configData.scheduleValue.split(':');
        const topic = configData.extraData?.topic || "오늘의 주요 IT 및 세계 뉴스 요약";
        const targetChannelId = configData.channelId;

        const cronExp = `0 ${minute} ${hour} * * *`;

        console.log(`[Briefing] 매일 ${hour}:${minute}에 '${topic}' 브리핑이 예약되었습니다.`);

        briefingTask = cron.schedule(cronExp, async () => {
            console.log(`[Briefing] 브리핑 생성 시작... 주제: ${topic}`);
            try {
                const channel = await client.channels.fetch(targetChannelId);
                if (!channel || !channel.isTextBased()) return;

                await channel.send(`📢 **일일 브리핑 시간이야!**\n 주제: '${topic}'에 대해 조사하고 있어. 잠시만 기다려줘! ☕`);

                const report = await deepResearch(topic);

                const files = [];
                let description = report;

                if (report.length > 2000) {
                    const buffer = Buffer.from(report, 'utf-8');
                    const attachment = new AttachmentBuilder(buffer, { name: 'Daily_Briefing.md' });
                    files.push(attachment);
                    description = `📑 **내용이 많아서 파일로 준비했어!**\n\n(요약)\n${report.substring(0, 500)}...`;
                }

                const embed = createAiResponseEmbed({
                    title: `📅 일일 브리핑: ${topic}`,
                    description: description,
                    footerPrefix: "Daily AI Briefing"
                });

                await channel.send({ embeds: [embed], files: files });

            } catch (error) {
                console.error('[Briefing] 실행 중 오류 발생:', error);
            }
        }, {
            timezone: "Asia/Seoul"
        });

    } catch (error) {
        console.error('[Briefing] 스케줄 로드 실패:', error);
    }
}

module.exports = { reloadBriefingSchedule };