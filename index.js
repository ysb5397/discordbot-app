// discord.js v14 이상 필요
// 필요한 모든 모듈을 한 번에 불러옵니다.
const {
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder,
    InteractionType, Events, ChannelType, GuildScheduledEventPrivacyLevel,
    GuildScheduledEventEntityType, PermissionsBitField,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType
} = require('discord.js');
// node-fetch v2 설치 필요 (npm install node-fetch@2)
const fetch = require('node-fetch');
const dotenv = require('dotenv');
const fs = require('fs').promises; // 비동기 파일 작업을 위해 promises API 사용
const path = require('path');      // 경로 관련 작업을 위해 추가 (선택 사항이지만 유용)
const { JSDOM } = require('jsdom');
const cron = require('node-cron');
dotenv.config(); // .env 파일 로드

// v14 Intents 사용
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,             // 서버 관련 기본 이벤트 (상호작용 포함)
        GatewayIntentBits.GuildMessages,      // 메시지 관련 Intent (필요시)
        GatewayIntentBits.MessageContent,     // 메시지 내용 접근 Intent (Privileged, 필요시)
        GatewayIntentBits.GuildScheduledEvents  // 서버 이벤트 관련 Intent (필요시)
    ]
});

// --- 환경 변수 확인 및 로드 ---
const discordToken = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

// API 설정 (서비스 키는 환경 변수로 관리하는 것이 더 안전하지만, 일단 기존 코드 구조를 따름)
const EQ_API_CONFIG = {
    serviceKey: process.env.EQK_API_KEY,
    url: "http://apis.data.go.kr/1360000/EqkInfoService/getEqkMsg",
    pageNo: 1,
    numOfRows: 10,
    dataType: "XML"
};

// 필수 환경 변수 확인
if (!discordToken || !clientId || !guildId || !flowiseEndpoint) {
    console.error("필수 환경 변수(DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, FLOWISE_ENDPOINT) 중 하나 이상이 설정되지 않았습니다.");
    process.exit(1);
}
if (!flowiseApiKey) {
    console.warn("환경 변수 'FLOWISE_API_KEY'가 설정되지 않았습니다. API 키가 필요 없는 Flowise 설정인 경우 무시하세요.");
}

// --- 봇 이름 변수 ---
let botName = "AI Assistant"; // 기본값 설정

// --- 유틸리티 함수 ---
// 시간 문자열 파싱 함수 (KST -> UTC Date 객체) - *** 수정됨: 복잡한 검증 로직 제거 ***
function parseKSTDateTime(dateTimeString) {
    const dateParts = dateTimeString.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})$/);
    if (!dateParts) throw new Error("Invalid date format. Use 'YYYY-MM-DD HH:MM'");
    const year = parseInt(dateParts[1]);
    const month = parseInt(dateParts[2]) - 1;
    const day = parseInt(dateParts[3]);
    const hourKST = parseInt(dateParts[4]);
    const minute = parseInt(dateParts[5]);
    const utcTimestamp = Date.UTC(year, month, day, hourKST - 9, minute);
    const dateObject = new Date(utcTimestamp);
    if (isNaN(dateObject.getTime())) throw new Error('Invalid date calculation');
    return dateObject;
}


// --- 슬래시 명령어 정의 (모든 명령어 통합) ---
const commands = [
    // ... (다른 명령어 정의들은 이전과 동일하게 유지) ...
    new SlashCommandBuilder()
        .setName('chat')
        .setDescription('AI와 대화합니다.')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('AI에게 할 질문 내용')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('AI에게 보여줄 파일을 첨부하세요 (이미지, 코드 등).')
                .setRequired(false)),
    new SlashCommandBuilder()
        .setName('deep_research')
        .setDescription('AI에게 심층 리서치를 요청합니다 (계획 확인 단계 포함).')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('리서치할 주제 또는 질문')
                .setRequired(true)),
    new SlashCommandBuilder().setName('help').setDescription('봇 도움말을 표시합니다.'),
    new SlashCommandBuilder().setName('avatar').setDescription('당신의 아바타 URL을 보여줍니다.'),
    new SlashCommandBuilder().setName('server').setDescription('서버 정보를 보여줍니다.'),
    new SlashCommandBuilder().setName('call').setDescription('콜백 메시지를 보냅니다.'),
    // ... (이벤트 관련 명령어 정의들도 이전과 동일하게 유지) ...
     new SlashCommandBuilder()
        .setName('create_event')
        .setDescription('서버 이벤트를 생성합니다.')
        .addStringOption(option => option.setName('name').setDescription('이벤트 이름').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('이벤트 설명').setRequired(true))
        .addStringOption(option => option.setName('start_time').setDescription("시작 시간 (예: '2025-05-10 20:00') - KST").setRequired(true))
        .addChannelOption(option => option.setName('channel').setDescription('이벤트 채널 (음성/스테이지/텍스트)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText).setRequired(true))
        .addStringOption(option => option.setName('end_time').setDescription("종료 시간 (예: '2025-05-10 22:00') - 텍스트 채널 시 필수").setRequired(false)),
    new SlashCommandBuilder()
        .setName('edit_event')
        .setDescription('기존 서버 이벤트를 수정합니다.')
        .addStringOption(option => option.setName('current_name').setDescription('수정할 이벤트의 현재 이름').setRequired(true))
        .addStringOption(option => option.setName('new_name').setDescription('새 이벤트 이름 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_description').setDescription('새 이벤트 설명 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_start_time').setDescription("새 시작 시간 (예: '2025-05-11 21:00') - KST").setRequired(false))
        .addChannelOption(option => option.setName('new_channel').setDescription('새 이벤트 채널 (선택 사항)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText).setRequired(false))
        .addStringOption(option => option.setName('new_end_time').setDescription("새 종료 시간 (예: '2025-05-11 23:00')").setRequired(false)),
    new SlashCommandBuilder()
        .setName('delete_event')
        .setDescription('서버 이벤트를 삭제합니다.')
        .addStringOption(option => option.setName('name').setDescription('삭제할 이벤트의 이름').setRequired(true))

].map(command => command.toJSON());

// --- 명령어 등록 로직 ---
const rest = new REST({ version: '10' }).setToken(discordToken);

(async () => {
    try {
        console.log('(/) 슬래시 명령어 등록 시작...');
        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );
        console.log('(/) 슬래시 명령어가 성공적으로 등록되었습니다.');
    } catch (error) {
        console.error('(/) 슬래시 명령어 등록 중 오류 발생:', error);
    }
})();


// --- 유틸리티 함수 (sleep) ---
const sleep = (ms) => { return new Promise((r) => setTimeout(r, ms)); }

// --- Discord 봇 로그인 ---
const discordLogin = async () => {
    try {
        await client.login(discordToken);
    } catch (error) {
        console.error("Discord 로그인 실패:", error.message);
        if (error.code === 'TOKEN_INVALID') {
            console.error("-> 제공된 토큰이 유효하지 않습니다.");
        }
        await sleep(5000);
        process.exit(1);
    }
}

discordLogin();

// 중복 알림 방지를 위해 마지막으로 전송한 지진의 발생 시각을 저장하는 변수
let lastEarthquakeTime = null;

/**
 * 1분마다 API를 호출하여 지진 정보를 확인하고 Discord에 알림을 보냅니다.
 */
async function checkEarthquakeAndNotify() {
    console.log('[EQK] 지진 정보 확인을 시작합니다...');

    // 1. API 호출을 위한 날짜 생성
    const today = new Date();
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(today.getDate() - 3);

    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
    };
    
    const url = `${EQ_API_CONFIG.url}?serviceKey=${EQ_API_CONFIG.serviceKey}&pageNo=${EQ_API_CONFIG.pageNo}&numOfRows=${EQ_API_CONFIG.numOfRows}&dataType=${EQ_API_CONFIG.dataType}&fromTmFc=${formatDate(threeDaysAgo)}&toTmFc=${formatDate(today)}`;

    try {
        // 2. API 데이터 요청 (fetch 사용)
        const response = await fetch(url, { timeout: 10000 }); // 10초 타임아웃
        if (!response.ok) {
            console.error(`[EQK] API 요청 실패. 상태 코드: ${response.status}`);
            return;
        }
        const xmlText = await response.text();

        // 3. XML 데이터 파싱
        const dom = new JSDOM(xmlText, { contentType: "application/xml" });
        const xmlDoc = dom.window.document;

        const items = xmlDoc.getElementsByTagName("item");
        let latestDomesticEq = null;

        for (const item of items) {
            const fcTp = item.querySelector("fcTp")?.textContent;
            if (fcTp === '3' || fcTp === '5') {
                latestDomesticEq = item;
                break; // 최신 국내 지진 정보를 찾으면 중단
            }
        }
        
        // 4. 최신 국내 지진 정보가 있으면 Embed 메시지 생성 및 전송
        if (latestDomesticEq) {
            const eqTime = latestDomesticEq.querySelector("tmEqk")?.textContent;

            // 이전에 보낸 지진 정보와 동일하면 무시 (중복 방지)
            if (eqTime && eqTime === lastEarthquakeTime) {
                console.log('[EQK] 새로운 지진 정보가 없습니다.');
                return;
            }
            
            // 새로운 정보이므로 마지막 지진 시간 갱신 및 알림 전송
            lastEarthquakeTime = eqTime;
            await sendEarthquakeAlert(latestDomesticEq);
        } else {
            console.log('[EQK] 최근 3일간 국내 지진 정보가 없습니다.');
        }

    } catch (error) {
        console.error('[EQK] 지진 정보 처리 중 오류 발생:', error.name === 'AbortError' ? 'Request Timeout' : error);
    }
}

/**
 * 지진 진도 문자열을 분석하여 지정된 색상 코드를 유연하게 반환하는 함수
 * @param {string} rawIntensityString - API에서 받은 원본 진도 문자열 (예: "Ⅴ(경북)", "진도 4")
 * @returns {number} - 16진수 색상 코드
 */
function getColorByIntensity(rawIntensityString) {
    // 입력값이 없거나 비어있으면 기본 회색 반환
    if (!rawIntensityString) {
        console.log(`[Color] Received empty or null intensity string.`);
        return 0x808080;
    }

    // 대소문자 구분 없이 비교하기 위해 모두 대문자로 변경
    const upperIntensity = rawIntensityString.toUpperCase();

    // 진도 10부터 1까지 순서대로 확인 (높은 숫자 우선)
    if (upperIntensity.includes('Ⅹ+') || upperIntensity.includes('10')) {
        return 0x000000; // 검정
    } else if (upperIntensity.includes('Ⅸ') || upperIntensity.includes('IX') || upperIntensity.includes('9')) {
        return 0x4C2600; // 진한 갈색
    } else if (upperIntensity.includes('Ⅷ') || upperIntensity.includes('VIII') || upperIntensity.includes('8')) {
        return 0x632523; // 갈색
    } else if (upperIntensity.includes('Ⅶ') || upperIntensity.includes('VII') || upperIntensity.includes('7')) {
        return 0xA32977; // 보라
    } else if (upperIntensity.includes('Ⅵ') || upperIntensity.includes('VI') || upperIntensity.includes('6')) {
        return 0xFF0000; // 빨강
    } else if (upperIntensity.includes('Ⅴ') || upperIntensity.includes('V') || upperIntensity.includes('5')) {
        return 0xFFC000; // 주황
    } else if (upperIntensity.includes('Ⅳ') || upperIntensity.includes('IV') || upperIntensity.includes('4')) {
        return 0xFFFF00; // 노랑
    } else if (upperIntensity.includes('Ⅲ') || upperIntensity.includes('III') || upperIntensity.includes('3')) {
        return 0x92D050; // 연한 초록
    } else if (upperIntensity.includes('Ⅱ') || upperIntensity.includes('II') || upperIntensity.includes('2')) {
        return 0xADE8FF; // 연한 파랑
    } else if (upperIntensity.includes('Ⅰ') || upperIntensity.includes('I') || upperIntensity.includes('1')) {
        return 0xFFFFFF; // 흰색
    } else {
        // 어떤 진도 값과도 일치하지 않을 경우
        console.log(`[Color] Unknown intensity value received: '${rawIntensityString}'`);
        return 0x808080; // 기본 회색
    }
}

/**
 * 파싱된 지진 정보를 받아 Discord Embed 메시지로 만들어 전송하는 함수
 * @param {Element} item - 파싱된 'item' XML 요소
 */
async function sendEarthquakeAlert(item) {
    const targetChannelId = '1388443793589538899'; // ❗ 채널 ID 확인 필요

    const rawIntensity = item.querySelector("inT")?.textContent || "정보 없음";
    
    // ✨[추가]✨ 진도 문자열에서 로마 숫자 부분만 추출 (예: "Ⅴ(경북)" -> "Ⅴ")
    const intensityValue = rawIntensity.split('(')[0]; 

    // ✨[추가]✨ 위에서 만든 함수를 호출하여 진도에 맞는 색상 가져오기
    const embedColor = getColorByIntensity(intensityValue);

    const rawTime = item.querySelector("tmEqk")?.textContent || "정보 없음";
    const formattedTime = `${rawTime.substring(0,4)}년 ${rawTime.substring(4,6)}월 ${rawTime.substring(6,8)}일 ${rawTime.substring(8,10)}시 ${rawTime.substring(10,12)}분`;

    const embed = new EmbedBuilder()
        .setColor(embedColor) // ✨[수정]✨ 하드코딩된 색상 대신 변수를 사용
        .setTitle('📢 실시간 국내 지진 정보')
        .setDescription(item.querySelector("rem")?.textContent || "상세 정보 없음")
        .addFields(
            { name: '📍 진원지', value: item.querySelector("loc")?.textContent || "정보 없음", inline: true },
            { name: '⏳ 발생시각', value: formattedTime, inline: true },
            { name: '📏 규모', value: `M ${item.querySelector("mt")?.textContent || "정보 없음"}`, inline: true },
            { name: '💥 최대진도', value: rawIntensity, inline: true }, // 전체 진도 정보 표시
            { name: ' 깊이', value: `${item.querySelector("dep")?.textContent || "?"}km`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: '출처: 기상청' });

    const imageUrl = item.querySelector("img")?.textContent;
    if (imageUrl) {
        embed.setImage(imageUrl);
    }

    try {
        const channel = await client.channels.fetch(targetChannelId);
        if (channel && channel.isTextBased()) {
            await channel.send({ embeds: [embed] });
            console.log(`[EQK] 채널(${targetChannelId})에 지진 정보를 성공적으로 전송했습니다.`);
        } else {
            console.error(`[EQK] ID(${targetChannelId})에 해당하는 채널을 찾을 수 없거나 텍스트 채널이 아닙니다.`);
        }
    } catch (error) {
        console.error('[EQK] Discord 메시지 전송 중 오류 발생:', error);
    }
}

// --- 이벤트 핸들러 ---
client.on(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}.`);

    console.log('Bot is ready and schedulers are being set up.');

    // --- 기존 Cron Job (매일 오전 9시 알림) ---
    cron.schedule('0 9 * * *', async () => {
        // ... (이전 코드 내용) ...
    }, {
        scheduled: true,
        timezone: "Asia/Seoul"
    });

    // ✨✨✨ [추가] 1분마다 지진 정보를 확인하는 Cron Job ✨✨✨
    cron.schedule('* * * * *', checkEarthquakeAndNotify, {
        scheduled: true,
        timezone: "Asia/Seoul"
    });

    // 봇 준비 완료 시 봇 이름 업데이트
    if (client.user && client.user.username) {
        botName = client.user.username;
        console.log(`Bot name set to: ${botName}`);
    } else {
        console.warn("봇 사용자 정보를 가져올 수 없어 기본 이름 'AI Assistant'를 사용합니다.");
    }
    console.log(`Flowise Endpoint: ${flowiseEndpoint}`);
});

// --- 임시 저장소 (간단한 예시) ---
const pendingResearch = new Map();

// --- 슬래시 명령어 및 버튼 상호작용 처리 핸들러 ---
client.on(Events.InteractionCreate, async interaction => {

    // --- 슬래시 명령어 처리 ---
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        console.log(`Processing slash command: /${commandName} by ${interaction.user.tag}`);
        console.log('DEBUG: Actual commandName received:', commandName);

        // --- /chat 명령어 처리 ---
        if (commandName === 'chat') {
            // ... (이전 /chat 처리 로직과 동일) ...
            // *** 수정 시작: console.log 추가 ***
            if (interaction.deferred || interaction.replied) return;
            try { await interaction.deferReply(); } catch (e) { console.error("Defer failed:", e); return; }

            const userQuestion = interaction.options.getString('question');
            const sessionId = interaction.user.id;
            const attachment = interaction.options.getAttachment('file');

            // ***** 추가된 디버그 로그 *****
            console.log(`[/chat] Flowise 요청 전 botName 변수 값: ${botName}`);

            const requestBody = {
                question: userQuestion,
                overrideConfig: { sessionId: sessionId, vars: { bot_name: botName } }
            };
            if (attachment) {
                requestBody.uploads = [{ type: 'url', name: attachment.name, mime: attachment.contentType || 'application/octet-stream', data: attachment.url }];
            }

            // ***** 추가된 디버그 로그 *****
            console.log(`[/chat Session: ${sessionId}] Sending to Flowise (Body):`, JSON.stringify(requestBody, null, 2));

            try {
                const response = await fetch(flowiseEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                    body: JSON.stringify(requestBody)
                });
                 // ... (이후 응답 처리 로직은 동일) ...
                 if (!response.ok) {
                    const errorData = await response.text();
                    console.error(`[/chat Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                    await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                    return;
                }
                const flowiseResponse = await response.json();
                let replyEmbeds = [];

                const imageUrl = flowiseResponse.imageUrl || (typeof flowiseResponse.text === 'string' && (flowiseResponse.text.startsWith('http://') || flowiseResponse.text.startsWith('https://')) && /\.(jpg|jpeg|png|gif)$/i.test(flowiseResponse.text) ? flowiseResponse.text : null);
                if (imageUrl) {
                     const imageEmbed = new EmbedBuilder().setTitle('AI가 생성한 이미지').setImage(imageUrl).setColor(0x0099FF);
                     replyEmbeds.push(imageEmbed);
                }
                const replyText = flowiseResponse.text;
                 if (replyText && !imageUrl) {
                    const textEmbed = new EmbedBuilder().setDescription(replyText.length > 4096 ? replyText.substring(0, 4093) + '...' : replyText).setColor(0x00FA9A).setTimestamp().setFooter({ text: '해당 결과는 AI에 의해 생성되었으며, 항상 정확한 결과를 도출하지 않습니다.' });
                    replyEmbeds.push(textEmbed);
                 } else if (!imageUrl && !replyText) {
                    const errorEmbed = new EmbedBuilder().setDescription('죄송합니다, AI로부터 답변을 받지 못했습니다.').setColor(0xFF0000);
                    replyEmbeds.push(errorEmbed);
                 }
                 await interaction.editReply({ content: `<@${interaction.user.id}>`, embeds: replyEmbeds });

            } catch (error) {
                console.error(`[/chat Session: ${sessionId}] Error processing Flowise request:`, error);
                try { await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 요청 처리 중 오류가 발생했습니다.`); } catch (e) { console.error("Edit reply failed:", e); }
            }
            // *** 수정 끝 ***
        }
        // --- /deep_research 명령어 처리 (1단계: 계획 요청) ---
        else if (commandName === 'deep_research') {
            if (interaction.deferred || interaction.replied) return;
            try { await interaction.deferReply(); } catch (e) { console.error("Defer failed for /deep_research:", e); return; }

            const userQuestion = interaction.options.getString('question');
            const sessionId = interaction.user.id;

            // --- AI 1 (분석가) 호출 ---
            let analystResponseText = '';
            try {
                console.log(`[/deep_research AI-1 Session: ${sessionId}] Sending to Flowise for initial analysis (Question: ${userQuestion})`);
                const requestBodyAI1 = {
                    question: userQuestion,
                    overrideConfig: {
                        sessionId: sessionId,
                        vars: { bot_name: botName },
                        // flowise_request_type: 'analyst_ai_phase' // 필요시 Flowise에서 단계 구분을 위한 플래그
                    }
                };

                const responseAI1 = await fetch(flowiseEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                    body: JSON.stringify(requestBodyAI1)
                });

                if (!responseAI1.ok) {
                    const errorData = await responseAI1.text();
                    console.error(`[/deep_research AI-1 Session: ${sessionId}] Flowise API Error: ${responseAI1.status} ${responseAI1.statusText}`, errorData);
                    await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 1차 분석 중 오류가 발생했습니다. (Code: ${responseAI1.status})`);
                    return;
                }
                const flowiseResponseAI1 = await responseAI1.json(); // 수정: response -> responseAI1
                console.log(`[/deep_research AI-1 Session: ${sessionId}] Received from Flowise:`, flowiseResponseAI1); // 수정: /chat -> /deep_research AI-1
                analystResponseText = flowiseResponseAI1.text || "1차 분석 결과를 받지 못했습니다.";

            } catch (error) {
                console.error(`[/deep_research AI-1 Session: ${sessionId}] Error processing Flowise request:`, error);
                // deferReply 후이므로 editReply 사용
                try { await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 1차 분석 요청 중 오류가 발생했습니다.`); } catch (e) { console.error("EditReply failed after AI-1 error:", e);}
                return;
            }

            // --- AI 2 (비평가/확장가) 호출 ---
            let criticResponseText = '';
            if (analystResponseText && analystResponseText !== "1차 분석 결과를 받지 못했습니다.") {
                try {
                    // 사용자에게 중간 진행 상황 알림 - 중요: deferReply 후 첫 editReply 이후에는 followUp 사용
                    // 하지만 여기서는 AI1에서 문제가 없었다면 editReply가 아직 사용되지 않았거나, 오류메시지로 사용되었을 수 있음.
                    // 명확성을 위해 AI1 성공 후엔 editReply로 중간 상태를 알리고, 최종은 followUp으로.
                    // 만약 AI1에서 오류로 editReply를 이미 했다면, 이부분은 실행되지 않음.
                    if (!interaction.replied && interaction.deferred) { // 아직 실제 응답(오류 아닌)이 나가지 않은 경우
                        await interaction.editReply({ content: `<@${interaction.user.id}> 1차 분석 완료. 추가 분석을 진행합니다...`, embeds: [] });
                    } else if (interaction.replied) { // AI1에서 오류 응답 등으로 이미 replied 상태라면 followUp으로 상태 알림
                        await interaction.followUp({ content: `<@${interaction.user.id}> 1차 분석은 완료되었으나, 추가 분석을 진행합니다... (이전 메시지에 오류가 있었을 수 있습니다.)`, ephemeral: true, embeds: [] });
                    }


                    console.log(`[/deep_research AI-2 Session: ${sessionId}] Sending to Flowise for critique/expansion (Prev. Analysis: ${analystResponseText.substring(0, 100)}...)`);
                    const requestBodyAI2 = {
                        question: `다음 분석 내용에 대해 비평하거나 확장된 의견을 제시해주세요: ${analystResponseText}`, // AI 1의 결과를 question으로 전달
                        overrideConfig: {
                            sessionId: sessionId,
                            vars: { bot_name: botName, previous_analysis: analystResponseText },
                            // flowise_request_type: 'critic_ai_phase' // 필요시 Flowise에서 단계 구분을 위한 플래그
                        }
                    };

                    const responseAI2 = await fetch(flowiseEndpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                        body: JSON.stringify(requestBodyAI2)
                    });

                    if (!responseAI2.ok) {
                        const errorData = await responseAI2.text();
                        console.error(`[/deep_research AI-2 Session: ${sessionId}] Flowise API Error: ${responseAI2.status} ${responseAI2.statusText}`, errorData);
                        // 중간 상태 알림 후이므로 followUp 사용
                        await interaction.followUp({ content: `<@${interaction.user.id}> 죄송합니다, AI 2차 분석 중 오류가 발생했습니다. (Code: ${responseAI2.status})`, ephemeral: true });
                        return;
                    }
                    const flowiseResponseAI2 = await responseAI2.json();
                    console.log(`[/deep_research AI-2 Session: ${sessionId}] Received from Flowise:`, flowiseResponseAI2);
                    criticResponseText = flowiseResponseAI2.text || "2차 분석 결과를 받지 못했습니다.";

                } catch (error) {
                    console.error(`[/deep_research AI-2 Session: ${sessionId}] Error processing Flowise request:`, error);
                    // 중간 상태 알림 후이므로 followUp 사용
                    try { await interaction.followUp({ content: `<@${interaction.user.id}> 죄송합니다, AI 2차 분석 요청 중 오류가 발생했습니다.`, ephemeral: true }); } catch (e) { console.error("FollowUp failed after AI-2 error:", e); }
                    return;
                }
            }

            // --- 최종 결과 조합 ---
            // AI 2의 응답(criticResponseText)에 요약과 본문이 모두 포함되어 있다고 가정
            // 또는, AI 1과 AI 2의 텍스트를 합친 후, 그 합친 텍스트에 대해 Flowise가 요약을 생성하도록 유도
            // 여기서는 criticResponseText (또는 이것이 비었다면 analystResponseText)를 fullText로 사용
            const fullTextForSummaryAndFile = criticResponseText || analystResponseText; // AI 2의 결과가 우선, 없으면 AI 1 결과
            const combinedForFile = `**[AI 1차 분석 결과]:**\n${analystResponseText}\n\n**[AI 2차 추가 의견]:**\n${criticResponseText || "(추가 의견 없음)"}`; // 파일에는 전체 히스토리

            let summaryText = "심층 분석 요약을 가져오지 못했습니다.";
            let mainContentForEmbed = fullTextForSummaryAndFile; // 임베드 설명용 (요약이 없을 경우)

            const summaryStartMarker = "SUMMARY_START";
            const summaryEndMarker = "SUMMARY_END";
            const summaryStartIndex = fullTextForSummaryAndFile.indexOf(summaryStartMarker);
            const summaryEndIndex = fullTextForSummaryAndFile.indexOf(summaryEndMarker);

            if (summaryStartIndex !== -1 && summaryEndIndex !== -1 && summaryStartIndex < summaryEndIndex) {
                summaryText = fullTextForSummaryAndFile.substring(summaryStartIndex + summaryStartMarker.length, summaryEndIndex).trim();
                // 임베드에는 요약을, 파일에는 전체 내용을 담는 원래 의도대로라면, mainContentForEmbed는 요약 후 본문이 될 수 있음
                // 하지만 여기서는 심플하게 요약만 추출하고, 파일에는 combinedForFile 전체를 넣기로 함
                console.log(`[/deep_research Session: ${sessionId}] Summary extracted: ${summaryText}`);
            } else {
                console.log(`[/deep_research Session: ${sessionId}] Summary markers not found in final response. Using first 200 chars for summary.`);
                summaryText = mainContentForEmbed.length > 200 ? mainContentForEmbed.substring(0, 197) + "..." : mainContentForEmbed;
                if (mainContentForEmbed === "1차 분석 결과를 받지 못했습니다." && mainContentForEmbed === "2차 분석 결과를 받지 못했습니다.") {
                    summaryText = "AI로부터 응답을 받지 못했습니다.";
                }
            }

            const replyEmbeds = [];
            const filesToSend = [];

            // Embed Title 길이 제한 처리
            let embedTitle = `'${userQuestion}'에 대한 심층 분석 요약`;
            if (embedTitle.length > 256) {
                embedTitle = embedTitle.substring(0, 253) + '...'; // 256자 제한에 맞춤
            }

            const summaryEmbed = new EmbedBuilder()
                .setTitle(embedTitle)
                .setDescription(summaryText.length > 4096 ? summaryText.substring(0, 4093) + '...' : summaryText)
                .setColor(0x00BFFF) // Deep research 색상 변경
                .setTimestamp()
                .setFooter({ text: '전체 분석 내용은 첨부된 파일을 확인해주세요.' });
            replyEmbeds.push(summaryEmbed);

            const fileNameSafe = `deep_research_${sessionId}_${Date.now()}.txt`.replace(/[^a-z0-9_.-]/gi, '_');
            const filePath = path.join(__dirname, fileNameSafe); // 또는 /tmp 사용 권장 (서버 환경)

            try {
                await fs.writeFile(filePath, combinedForFile); // 파일에는 AI1 + AI2 전체 내용을 저장
                filesToSend.push({ attachment: filePath, name: `deep_research_full_report.txt` });
                console.log(`[/deep_research Session: ${sessionId}] Full report saved to file: ${filePath}`);
            } catch (fileError) {
                console.error(`[/deep_research Session: ${sessionId}] Error writing to file:`, fileError);
                const errorEmbed = new EmbedBuilder().setDescription("⚠️ 전체 내용을 파일로 저장하는 중 오류가 발생했습니다.").setColor(0xFFCC00);
                replyEmbeds.push(errorEmbed);
            }

            // --- 최종 응답 전송 (followUp 사용) ---
            try {
                // AI 2 호출 전에 editReply로 중간 상태를 알렸으므로, 최종 결과는 followUp으로 전송
                await interaction.followUp({
                    content: `<@${interaction.user.id}> 심층 분석이 완료되었습니다.`,
                    embeds: replyEmbeds,
                    files: filesToSend.length > 0 ? filesToSend : undefined
                });
            } catch (replyError) {
                console.error(`[/deep_research Session: ${sessionId}] Error sending final followUp:`, replyError);
                try {
                    await interaction.followUp({ content: `<@${interaction.user.id}> 응답을 전송하는 중 문제가 발생했습니다.`, ephemeral: true });
                } catch (finalError) {
                    console.error(`[/deep_research Session: ${sessionId}] Critical error: Failed to send even a basic followUp.`, finalError);
                }
            } finally {
                if (filesToSend.length > 0) {
                    try {
                        await fs.unlink(filePath);
                        console.log(`[/deep_research Session: ${sessionId}] Temporary file deleted: ${filePath}`);
                    } catch (deleteError) {
                        console.error(`[/deep_research Session: ${sessionId}] Error deleting temporary file:`, deleteError);
                    }
                }
            }
        }
            // *** 수정 끝 ***
    

        // --- /create_event 명령어 처리 ---
        else if (commandName === 'create_event') {
            console.log('DEBUG: Entered create_event block');
            // 사용자 권한 확인
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
                 return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true });
            }
            // 봇 권한 확인
            if (!interaction.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageEvents)) {
                return interaction.reply({ content: '봇이 이벤트를 생성할 권한이 없습니다. 서버 관리자에게 문의하세요.', ephemeral: true });
            }

            try {
                await interaction.deferReply({ ephemeral: true });

                // 옵션 값 가져오기
                const eventName = interaction.options.getString('name');
                const eventDescription = interaction.options.getString('description');
                const startTimeString = interaction.options.getString('start_time');
                const eventChannel = interaction.options.getChannel('channel');
                const endTimeString = interaction.options.getString('end_time');

                // 시작 시간 처리 (KST 입력 -> UTC 변환)
                let scheduledStartTime;
                try {
                    // 수정된 parseKSTDateTime 함수 사용
                    scheduledStartTime = parseKSTDateTime(startTimeString);
                    if (scheduledStartTime < new Date()) { // 현재 시간보다 이전인지 확인
                        return interaction.editReply('오류: 이벤트 시작 시간은 현재 시간 이후여야 합니다.');
                    }
                    console.log(`[Schedule Create] Parsed start time: ${startTimeString} KST -> ${scheduledStartTime.toISOString()} UTC`);
                } catch (e) {
                    console.error("Start Date parsing error:", e);
                    // 사용자에게 명확한 형식 안내
                    return interaction.editReply(`오류: 시작 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요. (예: '2025-05-10 20:00')`);
                }

                // 종료 시간 처리
                let scheduledEndTime = null;
                if (endTimeString) {
                    try {
                        // 수정된 parseKSTDateTime 함수 사용
                        scheduledEndTime = parseKSTDateTime(endTimeString);
                        // 종료 시간이 시작 시간보다 이전이거나 같은지 확인
                        if (scheduledEndTime <= scheduledStartTime) {
                            return interaction.editReply('오류: 이벤트 종료 시간은 시작 시간 이후여야 합니다.');
                        }
                        console.log(`[Schedule Create] Parsed end time: ${endTimeString} KST -> ${scheduledEndTime.toISOString()} UTC`);
                    } catch (e) {
                        console.error("End Date parsing error:", e);
                        // 사용자에게 명확한 형식 안내
                        return interaction.editReply(`오류: 종료 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`);
                    }
                }

                // 이벤트 생성 옵션 구성
                const eventOptions = {
                    name: eventName,
                    description: eventDescription,
                    scheduledStartTime: scheduledStartTime, // UTC 기준 Date 객체
                    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly, // 서버 멤버만 볼 수 있도록 설정
                    entityType: null, // 채널 타입에 따라 설정됨
                    // entityMetadata는 External 타입일 때만 사용
                };

                // 채널 타입에 따라 entityType 및 관련 정보 설정
                if (eventChannel.type === ChannelType.GuildStageVoice) {
                    eventOptions.entityType = GuildScheduledEventEntityType.StageInstance;
                    eventOptions.channel = eventChannel.id; // 스테이지 채널 ID 설정
                    if (scheduledEndTime) eventOptions.scheduledEndTime = scheduledEndTime; // 종료 시간 설정 (선택)
                } else if (eventChannel.type === ChannelType.GuildVoice) {
                    eventOptions.entityType = GuildScheduledEventEntityType.Voice;
                    eventOptions.channel = eventChannel.id; // 음성 채널 ID 설정
                    if (scheduledEndTime) eventOptions.scheduledEndTime = scheduledEndTime; // 종료 시간 설정 (선택)
                } else if (eventChannel.type === ChannelType.GuildText) {
                    eventOptions.entityType = GuildScheduledEventEntityType.External; // 외부 이벤트로 설정
                    eventOptions.entityMetadata = { location: `#${eventChannel.name} 채널에서 진행` }; // 위치 정보 설정
                    // External 타입일 경우 종료 시간 필수
                    if (!scheduledEndTime) {
                        return interaction.editReply('오류: 텍스트 채널을 이벤트 장소로 지정할 경우, 반드시 종료 시간(`end_time` 옵션)을 입력해야 합니다.');
                    }
                    eventOptions.scheduledEndTime = scheduledEndTime; // 종료 시간 설정 (필수)
                } else {
                    // 지원하지 않는 채널 타입 처리
                    return interaction.editReply('오류: 지원하지 않는 채널 타입입니다. (음성, 스테이지, 텍스트 채널만 가능)');
                }

                // 이벤트 생성 시도
                const createdEvent = await interaction.guild.scheduledEvents.create(eventOptions);

                console.log(`Event created: ${createdEvent.name} (ID: ${createdEvent.id})`);
                // 사용자에게 성공 메시지 표시 (KST 기준 시간 포함)
                await interaction.editReply(`✅ 이벤트 "${createdEvent.name}"이(가) 성공적으로 생성되었습니다! (시작: ${startTimeString} KST${endTimeString ? `, 종료: ${endTimeString} KST` : ''})`);

            } catch (error) { // 이벤트 생성 중 오류 발생
                console.error('Error creating scheduled event:', error);
                // Discord API 오류 코드에 따른 분기 처리
                if (error.code === 50035 && error.message.includes('scheduled_end_time')) {
                     // 종료 시간 관련 오류 (주로 External 타입인데 종료 시간 누락 시)
                     await interaction.editReply('❌ 이벤트를 생성하는 중 오류가 발생했습니다. 텍스트 채널을 선택한 경우 종료 시간이 필요합니다.');
                } else {
                     // 기타 오류 (권한 부족, 잘못된 입력 등)
                     await interaction.editReply('❌ 이벤트를 생성하는 중 오류가 발생했습니다. 입력값, 봇 권한, 채널 설정을 확인해주세요.');
                }
            }
        }
        // --- /edit_event 명령어 처리 ---
        else if (commandName === 'edit_event') {
            console.log('DEBUG: Entered edit_event block');
            // 권한 확인
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
                 return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true });
            }
            if (!interaction.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageEvents)) {
                return interaction.reply({ content: '봇이 이벤트를 수정할 권한이 없습니다. 서버 관리자에게 문의하세요.', ephemeral: true });
            }

            try {
                await interaction.deferReply({ ephemeral: true });

                const currentName = interaction.options.getString('current_name');
                const newName = interaction.options.getString('new_name');
                const newDescription = interaction.options.getString('new_description');
                const newStartTimeString = interaction.options.getString('new_start_time');
                const newChannel = interaction.options.getChannel('new_channel');
                const newEndTimeString = interaction.options.getString('new_end_time');

                // 이름으로 이벤트 찾기 (대소문자 구분 없이)
                const events = await interaction.guild.scheduledEvents.fetch();
                const targetEvents = events.filter(event => event.name.toLowerCase() === currentName.toLowerCase());

                if (targetEvents.size === 0) {
                    return interaction.editReply(`❌ 이름이 "${currentName}"인 이벤트를 찾을 수 없습니다.`);
                }
                if (targetEvents.size > 1) {
                    // 중복 이름 처리: 사용자에게 ID로 다시 시도하도록 안내 (ID 기반 수정은 아직 구현 안 됨)
                    const eventList = targetEvents.map((event, id) => ` - ${event.name} (ID: ${id})`).join('\n');
                    return interaction.editReply(`❌ 이름이 "${currentName}"인 이벤트가 여러 개 있습니다. 더 구체적인 이름이나 ID로 수정해주세요.\n발견된 이벤트:\n${eventList}\n(ID 기반 수정은 아직 지원되지 않습니다.)`);
                }

                const eventToEdit = targetEvents.first();
                const editOptions = {}; // 수정할 옵션만 담을 객체

                // 각 옵션이 입력되었는지 확인하고 editOptions에 추가
                if (newName) editOptions.name = newName;
                if (newDescription) editOptions.description = newDescription;

                // 시작 시간 수정 처리
                if (newStartTimeString) {
                    try {
                        // 수정된 parseKSTDateTime 함수 사용
                        editOptions.scheduledStartTime = parseKSTDateTime(newStartTimeString);
                        if (editOptions.scheduledStartTime < new Date()) { // 현재 시간보다 이전인지 확인
                            return interaction.editReply('오류: 새 시작 시간은 현재 시간 이후여야 합니다.');
                        }
                        console.log(`[Schedule Edit] Parsed new start time: ${newStartTimeString} KST -> ${editOptions.scheduledStartTime.toISOString()} UTC`);
                    } catch (e) {
                        console.error("New Start Date parsing error:", e);
                        return interaction.editReply(`오류: 새 시작 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`);
                    }
                }

                // 종료 시간 수정 처리
                let newScheduledEndTime = null;
                if (newEndTimeString) {
                    try {
                        // 수정된 parseKSTDateTime 함수 사용
                        newScheduledEndTime = parseKSTDateTime(newEndTimeString);
                        // 수정될 시작 시간 또는 기존 시작 시간과 비교
                        const startTimeToCheck = editOptions.scheduledStartTime || eventToEdit.scheduledStartAt;
                        if (newScheduledEndTime <= startTimeToCheck) {
                            return interaction.editReply('오류: 새 종료 시간은 시작 시간 이후여야 합니다.');
                        }
                        editOptions.scheduledEndTime = newScheduledEndTime; // 수정 옵션에 추가
                        console.log(`[Schedule Edit] Parsed new end time: ${newEndTimeString} KST -> ${editOptions.scheduledEndTime.toISOString()} UTC`);
                    } catch (e) {
                        console.error("New End Date parsing error:", e);
                        return interaction.editReply(`오류: 새 종료 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`);
                    }
                }

                // 채널/위치 수정 처리
                if (newChannel) {
                    if (newChannel.type === ChannelType.GuildStageVoice) {
                        editOptions.entityType = GuildScheduledEventEntityType.StageInstance;
                        editOptions.channel = newChannel.id;
                        editOptions.entityMetadata = null; // 외부 위치 정보 제거
                    } else if (newChannel.type === ChannelType.GuildVoice) {
                        editOptions.entityType = GuildScheduledEventEntityType.Voice;
                        editOptions.channel = newChannel.id;
                        editOptions.entityMetadata = null; // 외부 위치 정보 제거
                    } else if (newChannel.type === ChannelType.GuildText) {
                        editOptions.entityType = GuildScheduledEventEntityType.External;
                        editOptions.entityMetadata = { location: `#${newChannel.name} 채널에서 진행` };
                        editOptions.channel = null; // 채널 ID 제거
                        // 외부 이벤트로 변경 시 종료 시간 확인 (수정 옵션 또는 기존 이벤트에서)
                        const endTimeToCheck = editOptions.scheduledEndTime || eventToEdit.scheduledEndAt;
                        if (!endTimeToCheck) {
                            // 새 종료 시간도 없고 기존 종료 시간도 없으면 오류
                            return interaction.editReply('오류: 이벤트 장소를 텍스트 채널(외부)로 변경하려면 종료 시간이 필요합니다. `new_end_time` 옵션도 함께 입력해주세요.');
                        }
                        // 종료 시간이 이미 설정되어 있다면 editOptions에 포함됨 (위에서 처리)
                    } else {
                        return interaction.editReply('오류: 지원하지 않는 채널 타입입니다.');
                    }
                } else if (eventToEdit.entityType === GuildScheduledEventEntityType.External) {
                     // 기존 이벤트가 External 타입인데, 채널 변경 없이 종료 시간만 수정하는 경우
                     // 또는 채널 변경 없이 아무것도 수정 안 하는 경우
                     // 이 경우, 종료 시간이 반드시 있어야 함 (수정 옵션 또는 기존 값)
                     const endTimeToCheck = editOptions.scheduledEndTime || eventToEdit.scheduledEndAt;
                     if (!endTimeToCheck) {
                         // 새 종료 시간도 없고 기존 종료 시간도 없으면 오류
                         return interaction.editReply('오류: 외부 이벤트에는 종료 시간이 필요합니다. `new_end_time` 옵션을 입력해주세요.');
                     }
                     // editOptions에 종료 시간이 없다면, 기존 종료 시간을 유지해야 함 (edit 호출 시 자동으로 유지됨)
                }


                // 수정할 내용이 있는지 확인
                if (Object.keys(editOptions).length === 0) {
                    return interaction.editReply('수정할 내용을 하나 이상 입력해주세요.');
                }

                // 이벤트 수정 시도
                const updatedEvent = await eventToEdit.edit(editOptions);

                console.log(`Event updated: ${updatedEvent.name} (ID: ${updatedEvent.id})`);
                await interaction.editReply(`✅ 이벤트 "${currentName}"이(가) 성공적으로 수정되었습니다! (새 이름: ${updatedEvent.name})`);

            } catch (error) { // 이벤트 수정 중 오류 발생
                console.error('Error editing scheduled event:', error);
                 // Discord API 오류 코드에 따른 분기 처리
                if (error.code === 50035) { // Invalid Form Body 오류
                     if (error.message.includes('scheduled_end_time')) {
                         await interaction.editReply('❌ 이벤트 수정 중 오류: 외부 이벤트에는 종료 시간이 필요합니다.');
                     } else if (error.message.includes('scheduled_start_time')) {
                         await interaction.editReply('❌ 이벤트 수정 중 오류: 시작 시간은 현재 시간 이후여야 합니다.');
                     } else {
                        // 기타 Form Body 오류
                        await interaction.editReply('❌ 이벤트 수정 중 오류가 발생했습니다. 입력값을 확인해주세요.');
                     }
                } else if (error.code === 50013) { // Missing Permissions 오류
                     await interaction.editReply('❌ 이벤트 수정 중 오류: 봇이 이벤트를 수정할 권한이 없습니다.');
                }
                else {
                    // 기타 예상치 못한 오류
                    await interaction.editReply('❌ 이벤트를 수정하는 중 오류가 발생했습니다. 입력값이나 봇 권한을 확인해주세요.');
                }
            }
        }
        // --- /delete_event 명령어 처리 ---
        else if (commandName === 'delete_event') {
            console.log('DEBUG: Entered delete_event block');
            // 권한 확인
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
                 return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true });
            }
            if (!interaction.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageEvents)) {
                return interaction.reply({ content: '봇이 이벤트를 삭제할 권한이 없습니다. 서버 관리자에게 문의하세요.', ephemeral: true });
            }

            try {
                await interaction.deferReply({ ephemeral: true });

                const eventName = interaction.options.getString('name');

                // 이름으로 이벤트 찾기 (대소문자 구분 없이)
                const events = await interaction.guild.scheduledEvents.fetch();
                const targetEvents = events.filter(event => event.name.toLowerCase() === eventName.toLowerCase());

                if (targetEvents.size === 0) {
                    return interaction.editReply(`❌ 이름이 "${eventName}"인 이벤트를 찾을 수 없습니다.`);
                }
                if (targetEvents.size > 1) {
                     // 중복 이름 처리: 사용자에게 ID로 다시 시도하도록 안내
                     const eventList = targetEvents.map((event, id) => ` - ${event.name} (ID: ${id})`).join('\n');
                    return interaction.editReply(`❌ 이름이 "${eventName}"인 이벤트가 여러 개 발견되었습니다. 삭제할 이벤트의 ID를 사용하여 다시 시도해주세요.\n발견된 이벤트:\n${eventList}\n(ID 기반 삭제는 아직 지원되지 않습니다.)`);
                }

                const eventToDelete = targetEvents.first();

                // 이벤트 삭제 시도
                await interaction.guild.scheduledEvents.delete(eventToDelete.id);

                console.log(`Event deleted: ${eventToDelete.name} (ID: ${eventToDelete.id})`);
                await interaction.editReply(`✅ 이벤트 "${eventName}"이(가) 성공적으로 삭제되었습니다!`);

            } catch (error) { // 이벤트 삭제 중 오류 발생
                console.error('Error deleting scheduled event:', error);
                // Discord API 오류 코드에 따른 분기 처리
                if (error.code === 50013) { // Missing Permissions 오류
                     await interaction.editReply('❌ 이벤트 삭제 중 오류: 봇이 이벤트를 삭제할 권한이 없습니다.');
                } else if (error.code === 10062) { // Unknown Interaction or Event 오류 (이미 삭제되었거나 존재하지 않음)
                     await interaction.editReply('❌ 이벤트 삭제 중 오류: 해당 이벤트를 찾을 수 없거나 이미 삭제되었습니다.');
                }
                else {
                    // 기타 예상치 못한 오류
                    await interaction.editReply('❌ 이벤트를 삭제하는 중 오류가 발생했습니다.');
                }
            }
        }
        // --- 다른 슬래시 명령어 처리 ---
        else if (commandName === 'help') {
            const embed = new EmbedBuilder().setTitle("도움말").setColor(0xFFD700).setDescription('명령어: /chat [질문] [file:첨부파일], /deep_research [질문], /help, /avatar, /server, /call, /create_event [옵션들], /edit_event [옵션들], /delete_event [이름]');
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        else if (commandName === 'avatar') { await interaction.reply({ content: interaction.user.displayAvatarURL(), ephemeral: true }); }
        else if (commandName === 'server') { await interaction.reply(`<@${interaction.user.id}> 현재 서버 이름: ${interaction.guild.name}\n총 멤버 수: ${interaction.guild.memberCount}`); }
        else if (commandName === 'call') { await interaction.reply(`<@${interaction.user.id}> !callback`); }
        // 이벤트 관련 명령어는 위에서 이미 처리됨
        // else if (commandName === 'create_event') { /* ... */ }
        // else if (commandName === 'edit_event') { /* ... */ }
        // else if (commandName === 'delete_event') { /* ... */ }

        // --- 버튼 상호작용 처리 ---
        else if (interaction.isButton()) {
            const customId = interaction.customId;
            console.log(`Processing button interaction: ${customId} by ${interaction.user.tag}`);

            // --- 심층 리서치 확인 버튼 처리 ---
            if (customId.startsWith('confirm_research_')) {
            // ... (이전 리서치 확인 버튼 로직과 동일) ...
            // *** 수정 시작: console.log 추가 ***
                const originalInteractionId = customId.replace('confirm_research_', '');
                const researchData = pendingResearch.get(originalInteractionId);

                if (!researchData || interaction.user.id !== researchData.sessionId) {
                    await interaction.reply({ content: "이 확인 버튼은 당신의 것이 아니거나 만료되었습니다.", ephemeral: true });
                    return;
                }

                try {
                    await interaction.update({ content: `<@${interaction.user.id}>\n리서치를 진행합니다... 잠시만 기다려주세요.`, embeds: interaction.message.embeds, components: [] });
                } catch (updateError) {
                    console.error("Failed to update interaction message:", updateError);
                }

                const { originalQuestion, sessionId } = researchData;

                // ***** 추가된 디버그 로그 *****
                console.log(`[/deep_research Execute] Flowise 요청 전 botName 변수 값: ${botName}`);

                const requestBody = {
                    question: `계획대로 \"${originalQuestion}\"에 대한 심층 리서치를 진행해 주세요.`,
                    overrideConfig: {
                        sessionId: sessionId,
                        vars: { bot_name: botName },
                        flowise_request_type: 'execute_research'
                    }
                };

                // ***** 추가된 디버그 로그 *****
                console.log(`[/deep_research Execute Session: ${sessionId}] Sending EXECUTE request to Flowise (Body):`, JSON.stringify(requestBody, null, 2));

                try {
                    const response = await fetch(flowiseEndpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                        body: JSON.stringify(requestBody)
                    });

                    // ... (이후 리서치 결과 처리 로직은 동일) ...
                    if (!response.ok) {
                        const errorData = await response.text();
                        console.error(`[/deep_research Execute Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                        await interaction.followUp({ content: `<@${interaction.user.id}> 죄송합니다, 리서치 실행 중 오류가 발생했습니다. (Code: ${response.status})`, ephemeral: true });
                        pendingResearch.delete(originalInteractionId);
                        return;
                    }

                    const flowiseResponse = await response.json();
                    console.log(`[/deep_research Execute Session: ${sessionId}] Received RESULT from Flowise:`, flowiseResponse);

                    let replyEmbeds = [];
                    const imageUrl = flowiseResponse.imageUrl || (typeof flowiseResponse.text === 'string' && (flowiseResponse.text.startsWith('http://') || flowiseResponse.text.startsWith('https://')) && /\.(jpg|jpeg|png|gif)$/i.test(flowiseResponse.text) ? flowiseResponse.text : null);
                    if (imageUrl) {
                        const imageEmbed = new EmbedBuilder().setTitle('리서치 관련 이미지').setImage(imageUrl).setColor(0x0099FF);
                        replyEmbeds.push(imageEmbed);
                    }
                    const replyText = flowiseResponse.text;
                    if (replyText && !imageUrl) {
                        const textEmbed = new EmbedBuilder()
                            .setTitle(`'${originalQuestion}'에 대한 심층 리서치 결과`)
                            .setDescription(replyText.length > 4096 ? replyText.substring(0, 4093) + '...' : replyText)
                            .setColor(0x00FA9A)
                            .setTimestamp()
                            .setFooter({ text: '해당 결과는 AI에 의해 생성되었으며, 항상 정확한 결과를 도출하지 않습니다.' });
                        replyEmbeds.push(textEmbed);
                    } else if (!imageUrl && !replyText) {
                        const errorEmbed = new EmbedBuilder().setDescription('죄송합니다, AI로부터 리서치 결과를 받지 못했습니다.').setColor(0xFF0000);
                        replyEmbeds.push(errorEmbed);
                    }

                    await interaction.followUp({ content: `<@${interaction.user.id}>`, embeds: replyEmbeds });
                    pendingResearch.delete(originalInteractionId);

                } catch (error) {
                    console.error(`[/deep_research Execute Session: ${sessionId}] Error processing Flowise request:`, error);
                    try {
                        await interaction.followUp({ content: `<@${interaction.user.id}> 죄송합니다, 리서치 결과 처리 중 오류가 발생했습니다.`, ephemeral: true });
                    } catch (e) {
                        console.error("FollowUp failed after error:", e);
                    }
                    pendingResearch.delete(originalInteractionId);
                }
                // *** 수정 끝 ***
            }
            // --- 심층 리서치 취소 버튼 처리 ---
            else if (customId.startsWith('cancel_research_')) {
                // ... (취소 버튼 로직은 이전과 동일하게 유지) ...
                const originalInteractionId = customId.replace('cancel_research_', '');
                const researchData = pendingResearch.get(originalInteractionId);

                if (!researchData || interaction.user.id !== researchData.sessionId) {
                    await interaction.reply({ content: "이 취소 버튼은 당신의 것이 아니거나 만료되었습니다.", ephemeral: true });
                    return;
                }

                await interaction.update({ content: `<@${interaction.user.id}>\n심층 리서치 요청이 취소되었습니다.`, embeds: interaction.message.embeds, components: [] });
                pendingResearch.delete(originalInteractionId);
            }
        }
    }
});

// --- 기존 메시지 기반 명령어 처리 (주석 처리 또는 제거 권장) ---
/*
client.on('messageCreate', async msg => {
    // 슬래시 명령어를 사용하는 것이 좋습니다.
});
*/
