// discord.js v14 이상 필요
// 필요한 모든 모듈을 한 번에 불러옵니다.
const {
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder,
    InteractionType, Events, ChannelType, GuildScheduledEventPrivacyLevel,
    GuildScheduledEventEntityType, PermissionsBitField,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType // 버튼 상호작용을 위해 추가
} = require('discord.js');
// node-fetch v2 설치 필요 (npm install node-fetch@2)
const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config(); // .env 파일 로드

// v14 Intents 사용
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        // *** 버튼 상호작용을 위해 추가 ***
        GatewayIntentBits.GuildInteraction // 버튼 클릭 등 상호작용 이벤트 수신
    ]
});

// --- 환경 변수 확인 및 로드 ---
const discordToken = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

// 필수 환경 변수 확인
if (!discordToken || !clientId || !guildId || !flowiseEndpoint) {
    console.error("필수 환경 변수(DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, FLOWISE_ENDPOINT) 중 하나 이상이 설정되지 않았습니다.");
    process.exit(1);
}
if (!flowiseApiKey) {
    console.warn("환경 변수 'FLOWISE_API_KEY'가 설정되지 않았습니다. API 키가 필요 없는 Flowise 설정인 경우 무시하세요.");
}

// --- 봇 이름 변수 ---
let botName = "AI Assistant";

// --- 유틸리티 함수 ---
// 시간 문자열 파싱 함수 (KST -> UTC Date 객체) - 변경 없음
function parseKSTDateTime(dateTimeString) {
    // ... (기존 코드와 동일) ...
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
    if (dateObject.getUTCFullYear() !== year ||
        dateObject.getUTCMonth() !== month ||
        dateObject.getUTCDate() !== day ||
        dateObject.getUTCHours() !== (hourKST - 9 + 24) % 24 ||
        dateObject.getUTCMinutes() !== minute) {
        throw new Error('Invalid date components after UTC conversion');
    }
    return dateObject;
}


// --- 슬래시 명령어 정의 (모든 명령어 통합) ---
const commands = [
    // /chat 명령어 - 변경 없음
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
    // *** /deep_research 명령어 추가 ***
    new SlashCommandBuilder()
        .setName('deep_research')
        .setDescription('AI에게 심층 리서치를 요청합니다 (계획 확인 단계 포함).')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('리서치할 주제 또는 질문')
                .setRequired(true)),
    // /help 명령어 - 변경 없음
    new SlashCommandBuilder().setName('help').setDescription('봇 도움말을 표시합니다.'),
    // /avatar 명령어 - 변경 없음
    new SlashCommandBuilder().setName('avatar').setDescription('당신의 아바타 URL을 보여줍니다.'),
    // /server 명령어 - 변경 없음
    new SlashCommandBuilder().setName('server').setDescription('서버 정보를 보여줍니다.'),
    // /call 명령어 - 변경 없음
    new SlashCommandBuilder().setName('call').setDescription('콜백 메시지를 보냅니다.'),
    // /create_event 명령어 - 변경 없음
    new SlashCommandBuilder()
        .setName('create_event')
        .setDescription('서버 이벤트를 생성합니다.')
        // ... (기존 옵션과 동일) ...
        .addStringOption(option => option.setName('name').setDescription('이벤트 이름').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('이벤트 설명').setRequired(true))
        .addStringOption(option => option.setName('start_time').setDescription("시작 시간 (예: '2025-05-10 20:00') - KST").setRequired(true))
        .addChannelOption(option => option.setName('channel').setDescription('이벤트 채널 (음성/스테이지/텍스트)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText).setRequired(true))
        .addStringOption(option => option.setName('end_time').setDescription("종료 시간 (예: '2025-05-10 22:00') - 텍스트 채널 시 필수").setRequired(false)),
    // /edit_event 명령어 - 변경 없음
    new SlashCommandBuilder()
        .setName('edit_event')
        .setDescription('기존 서버 이벤트를 수정합니다.')
        // ... (기존 옵션과 동일) ...
        .addStringOption(option => option.setName('current_name').setDescription('수정할 이벤트의 현재 이름').setRequired(true))
        .addStringOption(option => option.setName('new_name').setDescription('새 이벤트 이름 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_description').setDescription('새 이벤트 설명 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_start_time').setDescription("새 시작 시간 (예: '2025-05-11 21:00') - KST").setRequired(false))
        .addChannelOption(option => option.setName('new_channel').setDescription('새 이벤트 채널 (선택 사항)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText).setRequired(false))
        .addStringOption(option => option.setName('new_end_time').setDescription("새 종료 시간 (예: '2025-05-11 23:00')").setRequired(false)),
    // /delete_event 명령어 - 변경 없음
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
    // ... (기존 코드와 동일) ...
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

// --- 이벤트 핸들러 ---
client.on(Events.ClientReady, () => {
    // ... (기존 코드와 동일) ...
    console.log(`Logged in as ${client.user.tag}.`);
    botName = client.user.username;
    console.log(`Bot name set to: ${botName}`);
    console.log(`Flowise Endpoint: ${flowiseEndpoint}`);
});

// --- 임시 저장소 (간단한 예시) ---
// 실제 운영 시에는 DB나 Redis 등 외부 저장소 사용 고려
const pendingResearch = new Map(); // key: interaction.id, value: { originalQuestion, sessionId }

// --- 슬래시 명령어 및 버튼 상호작용 처리 핸들러 ---
client.on(Events.InteractionCreate, async interaction => {

    // --- 슬래시 명령어 처리 ---
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        console.log(`Processing slash command: /${commandName} by ${interaction.user.tag}`);

        // --- /chat 명령어 처리 ---
        if (commandName === 'chat') {
            // ... (기존 /chat 처리 로직과 거의 동일) ...
            if (interaction.deferred || interaction.replied) return;
            try { await interaction.deferReply(); } catch (e) { console.error("Defer failed:", e); return; }

            const userQuestion = interaction.options.getString('question');
            const sessionId = interaction.user.id;
            const attachment = interaction.options.getAttachment('file');
            const requestBody = {
                question: userQuestion,
                overrideConfig: { sessionId: sessionId, vars: { bot_name: botName } }
            };
            if (attachment) {
                requestBody.uploads = [{ type: 'url', name: attachment.name, mime: attachment.contentType || 'application/octet-stream', data: attachment.url }];
            }

            console.log(`[/chat Session: ${sessionId}] Sending to Flowise:`, JSON.stringify(requestBody, null, 2));
            try {
                const response = await fetch(flowiseEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                    body: JSON.stringify(requestBody)
                });
                if (!response.ok) { /* ... (기존 오류 처리) ... */
                    const errorData = await response.text();
                    console.error(`[/chat Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                    await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                    return;
                }
                const flowiseResponse = await response.json();
                console.log(`[/chat Session: ${sessionId}] Received from Flowise:`, flowiseResponse);

                // Embed 구성 및 응답 전송 (기존 로직 활용)
                let replyEmbeds = [];
                const imageUrl = flowiseResponse.imageUrl || (typeof flowiseResponse.text === 'string' && (flowiseResponse.text.startsWith('http://') || flowiseResponse.text.startsWith('https://')) && /\.(jpg|jpeg|png|gif)$/i.test(flowiseResponse.text) ? flowiseResponse.text : null);
                if (imageUrl) { /* ... (기존 이미지 처리) ... */
                     const imageEmbed = new EmbedBuilder().setTitle('AI가 생성한 이미지').setImage(imageUrl).setColor(0x0099FF);
                     replyEmbeds.push(imageEmbed);
                }
                const replyText = flowiseResponse.text;
                 if (replyText && !imageUrl) { /* ... (기존 텍스트 처리) ... */
                    const textEmbed = new EmbedBuilder().setDescription(replyText.length > 4096 ? replyText.substring(0, 4093) + '...' : replyText).setColor(0x00FA9A).setTimestamp().setFooter({ text: '해당 결과는 AI에 의해 생성되었으며, 항상 정확한 결과를 도출하지 않습니다.' });
                    replyEmbeds.push(textEmbed);
                 } else if (!imageUrl && !replyText) { /* ... (기존 빈 응답 처리) ... */
                    const errorEmbed = new EmbedBuilder().setDescription('죄송합니다, AI로부터 답변을 받지 못했습니다.').setColor(0xFF0000);
                    replyEmbeds.push(errorEmbed);
                 }
                 await interaction.editReply({ content: `<@${interaction.user.id}>`, embeds: replyEmbeds });

            } catch (error) { /* ... (기존 예외 처리) ... */
                console.error(`[/chat Session: ${sessionId}] Error processing Flowise request:`, error);
                try { await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 요청 처리 중 오류가 발생했습니다.`); } catch (e) { console.error("Edit reply failed:", e); }
            }
        }
        // --- /deep_research 명령어 처리 (1단계: 계획 요청) ---
        else if (commandName === 'deep_research') {
            if (interaction.deferred || interaction.replied) return;
            try { await interaction.deferReply(); } catch (e) { console.error("Defer failed:", e); return; }

            const userQuestion = interaction.options.getString('question');
            const sessionId = interaction.user.id;

            // Flowise에 첫 번째 요청 (계획 요청)
            const requestBody = {
                question: userQuestion, // 사용자의 초기 질문
                overrideConfig: {
                    sessionId: sessionId,
                    vars: { bot_name: botName },
                    // *** Flowise가 이 요청을 계획 요청으로 인식하도록 하는 플래그 (Flowise 워크플로우 설계에 따라 이름/값 조정 필요) ***
                    flowise_request_type: 'request_plan'
                }
            };

            console.log(`[/deep_research Session: ${sessionId}] Sending PLAN request to Flowise:`, JSON.stringify(requestBody, null, 2));
            try {
                const response = await fetch(flowiseEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) { /* ... (오류 처리) ... */
                    const errorData = await response.text();
                    console.error(`[/deep_research Plan Request Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                    await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 리서치 계획 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                    return;
                }

                const flowiseResponse = await response.json();
                console.log(`[/deep_research Plan Request Session: ${sessionId}] Received PLAN from Flowise:`, flowiseResponse);

                // *** Flowise 응답에서 계획 텍스트 추출 (Flowise 응답 구조에 맞게 키 이름 조정 필요) ***
                const researchPlanText = flowiseResponse.plan || flowiseResponse.text; // 예시: 'plan' 필드 또는 'text' 필드

                if (!researchPlanText) {
                    await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI로부터 리서치 계획을 받지 못했습니다.`);
                    return;
                }

                // 임시 저장소에 원본 질문 저장 (버튼 클릭 시 사용)
                pendingResearch.set(interaction.id, { originalQuestion: userQuestion, sessionId: sessionId });

                // 확인 버튼 생성
                const confirmButton = new ButtonBuilder()
                    .setCustomId(`confirm_research_${interaction.id}`) // 고유 ID 설정
                    .setLabel('계획대로 진행')
                    .setStyle(ButtonStyle.Success);

                const cancelButton = new ButtonBuilder()
                    .setCustomId(`cancel_research_${interaction.id}`) // 고유 ID 설정
                    .setLabel('취소')
                    .setStyle(ButtonStyle.Danger);

                const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

                // 사용자에게 계획 제안 및 버튼 표시
                const planEmbed = new EmbedBuilder()
                    .setTitle("🔍 심층 리서치 계획 제안")
                    .setDescription(researchPlanText) // Flowise가 생성한 계획 메시지
                    .setColor(0x5865F2) // Discord Blurple
                    .setFooter({ text: "아래 버튼을 눌러 진행 여부를 선택해주세요." });

                await interaction.editReply({ content: `<@${interaction.user.id}>`, embeds: [planEmbed], components: [row] });

            } catch (error) { /* ... (예외 처리) ... */
                console.error(`[/deep_research Plan Request Session: ${sessionId}] Error processing Flowise request:`, error);
                 try { await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 리서치 계획 요청 중 오류가 발생했습니다.`); } catch (e) { console.error("Edit reply failed:", e); }
            }
        }
        // --- 다른 슬래시 명령어 처리 ---
        else if (commandName === 'help') { /* ... (기존 코드) ... */
            const embed = new EmbedBuilder().setTitle("도움말").setColor(0xFFD700).setDescription('명령어: /chat [질문] [file:첨부파일], /deep_research [질문], /help, /avatar, /server, /call, /create_event [옵션들], /edit_event [옵션들], /delete_event [이름]'); // /deep_research 추가
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        else if (commandName === 'avatar') { /* ... (기존 코드) ... */ await interaction.reply({ content: interaction.user.displayAvatarURL(), ephemeral: true }); }
        else if (commandName === 'server') { /* ... (기존 코드) ... */ await interaction.reply(`<@${interaction.user.id}> 현재 서버 이름: ${interaction.guild.name}\n총 멤버 수: ${interaction.guild.memberCount}`); }
        else if (commandName === 'call') { /* ... (기존 코드) ... */ await interaction.reply(`<@${interaction.user.id}> !callback`); }
        else if (commandName === 'create_event') { /* ... (기존 코드) ... */ }
        else if (commandName === 'edit_event') { /* ... (기존 코드) ... */ }
        else if (commandName === 'delete_event') { /* ... (기존 코드) ... */ }

    }
    // --- 버튼 상호작용 처리 ---
    else if (interaction.isButton()) {
        const customId = interaction.customId;
        console.log(`Processing button interaction: ${customId} by ${interaction.user.tag}`);

        // --- 심층 리서치 확인 버튼 처리 ---
        if (customId.startsWith('confirm_research_')) {
            const originalInteractionId = customId.replace('confirm_research_', '');
            const researchData = pendingResearch.get(originalInteractionId);

            // 원본 요청 정보가 없거나 다른 사용자의 클릭이면 무시
            if (!researchData || interaction.user.id !== researchData.sessionId) {
                await interaction.reply({ content: "이 확인 버튼은 당신의 것이 아니거나 만료되었습니다.", ephemeral: true });
                return;
            }

            try {
                // 버튼 클릭 후 대기 메시지 표시 (버튼 비활성화)
                await interaction.update({ content: `<@${interaction.user.id}>\n리서치를 진행합니다... 잠시만 기다려주세요.`, embeds: interaction.message.embeds, components: [] }); // 버튼 제거
            } catch (updateError) {
                console.error("Failed to update interaction message:", updateError);
                // 업데이트 실패 시 새 메시지로 응답 시도 (선택적)
                // await interaction.followUp({ content: '리서치를 진행합니다...', ephemeral: true });
            }


            const { originalQuestion, sessionId } = researchData;

            // Flowise에 두 번째 요청 (실제 검색 실행 요청)
            const requestBody = {
                // *** Flowise가 사용자의 확인을 인식하도록 하는 메시지 또는 플래그 (Flowise 워크플로우 설계에 따라 조정 필요) ***
                question: `계획대로 \"${originalQuestion}\"에 대한 심층 리서치를 진행해 주세요.`,
                overrideConfig: {
                    sessionId: sessionId,
                    vars: { bot_name: botName },
                    flowise_request_type: 'execute_research' // 예시 플래그
                }
                // 필요하다면 원래 질문을 다른 필드로 전달할 수도 있음
                // original_question: originalQuestion
            };

            console.log(`[/deep_research Execute Session: ${sessionId}] Sending EXECUTE request to Flowise:`, JSON.stringify(requestBody, null, 2));
            try {
                const response = await fetch(flowiseEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) { /* ... (오류 처리, interaction.editReply 사용) ... */
                     const errorData = await response.text();
                     console.error(`[/deep_research Execute Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                     // interaction.update() 후에는 editReply 대신 followUp 사용해야 할 수 있음
                     await interaction.followUp({ content: `<@${interaction.user.id}> 죄송합니다, 리서치 실행 중 오류가 발생했습니다. (Code: ${response.status})`, ephemeral: true });
                     return;
                }

                const flowiseResponse = await response.json();
                console.log(`[/deep_research Execute Session: ${sessionId}] Received RESULT from Flowise:`, flowiseResponse);

                // 최종 리서치 결과 Embed 구성 및 표시 (기존 /chat 응답 처리 로직 활용)
                let replyEmbeds = [];
                // 이미지 URL 처리 (리서치 결과에 이미지가 포함될 경우)
                const imageUrl = flowiseResponse.imageUrl || (typeof flowiseResponse.text === 'string' && (flowiseResponse.text.startsWith('http://') || flowiseResponse.text.startsWith('https://')) && /\.(jpg|jpeg|png|gif)$/i.test(flowiseResponse.text) ? flowiseResponse.text : null);
                 if (imageUrl) {
                      const imageEmbed = new EmbedBuilder().setTitle('리서치 관련 이미지').setImage(imageUrl).setColor(0x0099FF);
                      replyEmbeds.push(imageEmbed);
                 }
                // 텍스트 결과 처리
                const replyText = flowiseResponse.text;
                if (replyText && !imageUrl) {
                    const textEmbed = new EmbedBuilder()
                        .setTitle(`'${originalQuestion}'에 대한 심층 리서치 결과`) // 제목 추가
                        .setDescription(replyText.length > 4096 ? replyText.substring(0, 4093) + '...' : replyText)
                        .setColor(0x00FA9A)
                        .setTimestamp()
                        .setFooter({ text: '해당 결과는 AI에 의해 생성되었으며, 항상 정확한 결과를 도출하지 않습니다.' });
                    replyEmbeds.push(textEmbed);
                } else if (!imageUrl && !replyText) {
                    const errorEmbed = new EmbedBuilder().setDescription('죄송합니다, AI로부터 리서치 결과를 받지 못했습니다.').setColor(0xFF0000);
                    replyEmbeds.push(errorEmbed);
                }

                // interaction.update() 후에는 editReply 대신 followUp 사용
                await interaction.followUp({ content: `<@${interaction.user.id}>`, embeds: replyEmbeds });

                // 처리 완료 후 임시 저장소에서 데이터 제거
                pendingResearch.delete(originalInteractionId);

            } catch (error) { /* ... (예외 처리, interaction.followUp 사용) ... */
                 console.error(`[/deep_research Execute Session: ${sessionId}] Error processing Flowise request:`, error);
                 try { await interaction.followUp({ content: `<@${interaction.user.id}> 죄송합니다, 리서치 결과 처리 중 오류가 발생했습니다.`, ephemeral: true }); } catch (e) { console.error("FollowUp failed:", e); }
                 // 오류 발생 시에도 임시 데이터 정리
                 pendingResearch.delete(originalInteractionId);
            }
        }
        // --- 심층 리서치 취소 버튼 처리 ---
        else if (customId.startsWith('cancel_research_')) {
            const originalInteractionId = customId.replace('cancel_research_', '');
            const researchData = pendingResearch.get(originalInteractionId);

            // 원본 요청 정보가 없거나 다른 사용자의 클릭이면 무시
            if (!researchData || interaction.user.id !== researchData.sessionId) {
                await interaction.reply({ content: "이 취소 버튼은 당신의 것이 아니거나 만료되었습니다.", ephemeral: true });
                return;
            }

            // 메시지 업데이트하여 취소됨을 알림 (버튼 제거)
            await interaction.update({ content: `<@${interaction.user.id}>\n심층 리서치 요청이 취소되었습니다.`, embeds: interaction.message.embeds, components: [] });

            // 임시 저장소에서 데이터 제거
            pendingResearch.delete(originalInteractionId);
        }
    }
});

// --- 기존 메시지 기반 명령어 처리 (주석 처리 또는 제거) ---
/*
client.on('messageCreate', async msg => {
    // ...
});
*/
// ```

// **주요 변경 사항:**

// 1.  **`/deep_research` 명령어 추가:** 슬래시 명령어 목록에 `/deep_research`를 추가하고 `question` 옵션을 정의했습니다.
// 2.  **버튼 관련 모듈 추가:** `ActionRowBuilder`, `ButtonBuilder`, `ButtonStyle`, `ComponentType`을 `require('discord.js')`에 추가했습니다.
// 3.  **`GuildInteraction` Intent 추가:** 버튼 클릭 이벤트를 수신하기 위해 Client Intents에 `GatewayIntentBits.GuildInteraction`를 추가했습니다.
// 4.  **임시 저장소 (`pendingResearch`) 추가:** 사용자의 초기 질문과 세션 ID를 잠시 저장하여 버튼 클릭 시 원본 요청 정보를 참조할 수 있도록 간단한 `Map` 객체를 사용했습니다. (실제 운영 시에는 더 안정적인 방법 고려)
// 5.  **`/deep_research` 명령어 처리 로직 (1단계):**
//     * 사용자 질문을 받아 Flowise에 **계획 요청**을 보냅니다. (`overrideConfig`에 `flowise_request_type: 'request_plan'` 같은 플래그 추가 - Flowise 워크플로우와 협의 필요)
//     * Flowise로부터 **계획 제안 메시지**를 받습니다. (응답 JSON의 `plan` 또는 `text` 필드 사용 가정 - Flowise 워크플로우와 협의 필요)
//     * 원본 질문과 세션 ID를 `pendingResearch`에 저장합니다.
//     * '계획대로 진행', '취소' 버튼을 생성하여 사용자에게 계획과 함께 보여줍니다. (`interaction.editReply` 사용)
// 6.  **버튼 상호작용 처리 로직 (`interaction.isButton()`):**
//     * **확인 버튼 (`confirm_research_...`) 처리:**
//         * `pendingResearch`에서 원본 요청 정보를 가져옵니다.
//         * 버튼 클릭 메시지를 업데이트하여 대기 상태를 알립니다 (`interaction.update`).
//         * Flowise에 **실행 요청**을 보냅니다. (사용자가 확인했음을 알리는 메시지나 플래그 포함 - Flowise 워크플로우와 협의 필요)
//         * Flowise로부터 **최종 리서치 결과**를 받습니다.
//         * 결과를 Embed로 구성하여 사용자에게 보여줍니다 (`interaction.followUp` 사용 - `update` 후에는 `editReply` 사용 불가).
//         * `pendingResearch`에서 해당 요청 정보를 제거합니다.
//     * **취소 버튼 (`cancel_research_...`) 처리:**
//         * 메시지를 업데이트하여 취소되었음을 알립니다 (`interaction.update`).
//         * `pendingResearch`에서 해당 요청 정보를 제거합니다.
// 7.  **`/help` 명령어 설명 업데이트:** 도움말에 `/deep_research` 명령어를 추가했습니다.

// 이 코드를 적용하기 전에 **Flowise 워크플로우를 2단계 상호작용에 맞게 수정하는 것이 선행**되어야 하며, 코드 내에서 Flowise와 주고받는 데이터 형식(예: `flowise_request_type`, `plan` 필드 등)은 실제 Flowise 워크플로우 설계에 따라 정확히 맞춰주어야 합
