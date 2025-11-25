// utils/memory_scheduler.js

const cron = require('node-cron');
const { Interaction, MemoryReport } = require('./database.js');
const { consolidateMemories } = require('./ai_helper.js');

/**
 * 메모리 통합 스케줄러 시작
 */
function startMemoryConsolidationSchedule() {
    // 매일 자정 (0시 0분 0초) 실행
    cron.schedule('0 0 0 * * *', async () => {
        console.log('🧠 [Memory Scheduler] 일일 기억 정리 작업을 시작합니다...');

        try {
            // 1. 정리되지 않은 기억(isConsolidated: false)이 있는 유저 목록 찾기
            const userIds = await Interaction.distinct('userId', {
                isConsolidated: false,
                type: { $in: ['MESSAGE', 'MENTION'] } // 에러 로그 등은 제외
            });

            if (userIds.length === 0) {
                console.log('🧠 [Memory Scheduler] 정리할 새로운 기억이 없습니다.');
                return;
            }

            console.log(`🧠 [Memory Scheduler] 총 ${userIds.length}명의 기억을 정리합니다.`);

            // 2. 각 유저별로 순회하며 정리
            for (const userId of userIds) {
                try {
                    // 해당 유저의 처리 안 된 기억 불러오기
                    const unconsolidatedDocs = await Interaction.find({
                        userId: userId,
                        isConsolidated: false,
                        type: { $in: ['MESSAGE', 'MENTION'] }
                    }).sort({ timestamp: 1 }); // 시간순 정렬

                    if (unconsolidatedDocs.length === 0) continue;

                    // 기존 리포트 가져오기
                    let report = await MemoryReport.findOne({ userId: userId });
                    const prevSummary = report ? report.summary : "";

                    // AI에게 보낼 텍스트 변환
                    const newMemories = unconsolidatedDocs.map(doc => {
                        const content = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);
                        return `User: ${content}\nBot: ${doc.botResponse || ""}`;
                    });

                    console.log(`⏳ [${userId}] 기억 통합 중... (${newMemories.length}건)`);

                    // AI 요약 요청
                    const newSummary = await consolidateMemories(prevSummary, newMemories);

                    // DB 업데이트 (Upsert)
                    await MemoryReport.findOneAndUpdate(
                        { userId: userId },
                        {
                            summary: newSummary,
                            lastUpdatedAt: new Date()
                        },
                        { upsert: true, new: true }
                    );

                    // 처리된 기억들에 플래그 세우기 (Batch Update)
                    const docIds = unconsolidatedDocs.map(d => d._id);
                    await Interaction.updateMany(
                        { _id: { $in: docIds } },
                        { $set: { isConsolidated: true } }
                    );

                    console.log(`✅ [${userId}] 기억 통합 완료!`);

                } catch (userError) {
                    console.error(`❌ [${userId}] 처리 중 오류 발생:`, userError);
                }
            }

            console.log('🧠 [Memory Scheduler] 모든 작업이 완료되었습니다.');

        } catch (error) {
            console.error('❌ [Memory Scheduler] 스케줄러 실행 중 치명적 오류:', error);
        }
    }, {
        timezone: "Asia/Seoul"
    });

    console.log('✅ [Scheduler] 기억 정리 스케줄러가 등록되었습니다. (매일 자정)');
}

module.exports = { startMemoryConsolidationSchedule };