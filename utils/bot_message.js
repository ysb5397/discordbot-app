// utils/bot_message.js

const { ActivityType } = require('discord.js');
const fetch = require('node-fetch');
const { earthquakeMonitorStatus } = require('./earthquake.js');

const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const geminiEndpoint = process.env.GEMINI_API_KEY; // 사용자가 설정해야 할 환경 변수

// --- 헬퍼 함수: 상태에 따른 이모티콘 반환 ---
function getStatusEmoji(status) {
    if (status === '정상') return '🟢';
    if (status === '키 없음') return '🟡';
    if (status.startsWith('오류')) return '🔴';
    if (status === '오프라인') return '⚫';
    return '❓'; // 초기화 중 또는 기타
}

// --- 핵심 로직: 상태 메시지 업데이트 ---
async function updateBotStatus(client) {
    try {
        // 1. 각 서비스 상태 확인
        const eqStatus = earthquakeMonitorStatus; // earthquake.js에서 직접 상태 가져오기

        let flowiseStatus = '대기';
        if (flowiseEndpoint) {
            try {
                const response = await fetch(flowiseEndpoint, { method: 'POST', body: JSON.stringify({ question: 'ping' }), timeout: 5000 });
                flowiseStatus = response.ok ? '정상' : `오류 ${response.status}`;
            } catch (error) {
                flowiseStatus = '오프라인';
            }
        } else {
            flowiseStatus = '키 없음';
        }

        let geminiStatus = '대기';
        if (geminiEndpoint) {
            try {
                const response = await fetch(geminiEndpoint, { method: 'GET', timeout: 5000 });
                geminiStatus = response.ok ? '정상' : `오류 ${response.status}`;
            } catch (error) {
                geminiStatus = '오프라인';
            }
        } else {
            geminiStatus = '키 없음';
        }

        // 2. 상태 메시지 조합
        const statusText = `지진: ${eqStatus} | Flowise: ${flowiseStatus} | Gemini: ${geminiStatus}`;
        
        // 3. 봇 활동 설정
        client.user.setActivity(statusText, { type: ActivityType.Watching });

        console.log(`[Status] 봇 상태 메시지 업데이트: ${statusText}`);

    } catch (error) {
        console.error('[Status] 상태 업데이트 중 오류 발생:', error);
        client.user.setActivity('상태 업데이트 오류', { type: ActivityType.Playing });
    }
}

// --- 스케줄러 로직 ---
function startStatusUpdater(client) {
    console.log('[Status] 봇 상태 메시지 자동 업데이트를 시작합니다.');
    
    // 처음 한 번 즉시 실행
    updateBotStatus(client);
    
    // 1분마다 주기적으로 실행
    setInterval(() => updateBotStatus(client), 60 * 1000);
}

module.exports = {
    startStatusUpdater
};
