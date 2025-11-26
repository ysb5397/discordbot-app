const cron = require('node-cron');
const { SchedulerConfig } = require('../system/database.js');
const { deepResearch } = require('../ai/ai_helper.js');
const { createAiResponseEmbed } = require('../ui/embed_builder.js');
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

                // [수정됨] deepResearch 결과는 객체이므로 구조 분해 할당으로 받아야 해!
                const { fileContent, embedContent } = await deepResearch(topic);

                const files = [];

                // 파일 내용(상세 리포트)이 있으면 첨부 파일로 만듦
                if (fileContent) {
                    const buffer = Buffer.from(fileContent, 'utf-8');
                    const attachment = new AttachmentBuilder(buffer, { name: 'Daily_Briefing.md' });
                    files.push(attachment);
                }

                // 임베드에는 요약 내용(embedContent)을 넣음
                const embed = createAiResponseEmbed({
                    title: `📅 일일 브리핑: ${topic}`,
                    description: embedContent || "요약된 내용이 없어... 파일을 확인해줘!",
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