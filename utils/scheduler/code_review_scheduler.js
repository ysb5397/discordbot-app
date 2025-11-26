// utils/code_review_scheduler.js

const cron = require('node-cron');
const { exec } = require('child_process');
const { analyzeCode } = require('../ai/ai_helper.js');
const { createAiResponseEmbed } = require('../ui/embed_builder.js');
const { AttachmentBuilder } = require('discord.js');
const config = require('../../config/manage_environments.js');

// 리뷰 결과를 받을 채널 ID (환경변수 혹은 기존 로그 채널 사용)
// 없으면 로그 채널로 쏘도록 설정
const REVIEW_CHANNEL_ID = config.channels.ignoreAiChat || config.discord.logChannelId;

/**
 * 지난주 금요일부터 오늘까지의 변경 사항(Diff)을 추출하는 함수
 */
function getWeeklyGitDiff() {
    return new Promise((resolve, reject) => {
        // 1주일 전 날짜 계산 (git log --since="1 week ago" 활용 가능)
        // 여기서는 단순히 최근 변경 사항들을 diff로 뽑아냄
        exec('git diff --stat --patch @{1.week.ago}', { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                // Git이 없거나 레포지토리가 아닐 경우 대비 (Docker 환경 주의)
                console.warn('[CodeReview] Git diff 실패 (아마도 .git 폴더 부재?):', error.message);
                resolve(null);
            } else {
                if (!stdout || stdout.trim().length === 0) {
                    resolve("변경 사항 없음");
                } else {
                    resolve(stdout);
                }
            }
        });
    });
}

function startCodeReviewSchedule(client) {
    // 매주 금요일 밤 9시 (0 21 * * 5)
    cron.schedule('0 21 * * 5', async () => {
        console.log('[Scheduler] 주간 코드 리뷰 시작...');

        const channel = await client.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null);
        if (!channel) {
            console.error('[Scheduler] 리뷰를 보낼 채널을 찾을 수 없습니다.');
            return;
        }

        try {
            // 1. Git Diff 가져오기
            let diffData = await getWeeklyGitDiff();

            // Git이 안 되거나 변경점이 없을 때의 처리
            if (!diffData) {
                // Docker 환경이라 .git이 없다면, 주요 파일(main.py, index.js 등)을 읽어서 보내는 대안 로직이 필요할 수도 있음.
                // 일단은 스킵.
                console.log('[Scheduler] 분석할 Git 변경 사항이 없어 건너뜁니다.');
                return;
            }

            if (diffData === "변경 사항 없음") {
                await channel.send("📅 **주간 코드 리뷰**: 이번 주는 코드가 변경된 게 없어서 쉴게! 꿀잠~ 💤");
                return;
            }

            // 너무 길면 자름 (Python 토큰 한계 고려)
            if (diffData.length > 30000) {
                diffData = diffData.substring(0, 30000) + "\n...(내용이 너무 길어서 잘림)...";
            }

            await channel.send("☕ **금요일 밤이야!** 지난주 코드 변경 사항을 점검하고 있어. 잠시만 기다려줘! 🧐");

            // 2. AI 분석 요청
            const { fileContent, embedContent } = await analyzeCode(diffData);

            // 3. 파일 생성
            const files = [];
            if (fileContent) {
                const buffer = Buffer.from(fileContent, 'utf-8');
                const attachment = new AttachmentBuilder(buffer, { name: `Weekly_Code_Review_${new Date().toISOString().split('T')[0]}.md` });
                files.push(attachment);
            }

            // 4. 임베드 생성
            const embed = createAiResponseEmbed({
                title: `📅 주간 코드 리뷰 리포트`,
                description: embedContent,
                footerPrefix: "Weekly Automated Code Review"
            });

            // 5. 전송
            await channel.send({ embeds: [embed], files: files });
            console.log('[Scheduler] 주간 코드 리뷰 전송 완료.');

        } catch (error) {
            console.error('[Scheduler] 코드 리뷰 중 오류 발생:', error);
            // 오류 나면 조용히 로그만 남기거나 관리자에게 알림
        }
    }, {
        timezone: "Asia/Seoul"
    });

    console.log('✅ [Scheduler] 주간 코드 리뷰 스케줄러가 등록되었습니다. (매주 금 21:00)');
}

module.exports = { startCodeReviewSchedule };