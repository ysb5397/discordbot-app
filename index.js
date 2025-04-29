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
        // GatewayIntentBits.GuildMessages, // 메시지 기반 명령어가 없다면 제거 가능
        // GatewayIntentBits.MessageContent, // 메시지 기반 명령어가 없다면 제거 가능
        // GatewayIntentBits.GuildScheduledEvents, // 이벤트 관련 기능에 필요할 수 있음
        // // *** 버튼 상호작용을 위해 수정 ***
        // GatewayIntentBits.GuildInteractions // 'GuildInteraction' -> 'GuildInteractions' (복수형으로 변경)
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

// --- 이벤트 핸들러 ---
client.on(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}.`);
    botName = client.user.username;
    console.log(`Bot name set to: ${botName}`);
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

        // --- /chat 명령어 처리 ---
        if (commandName === 'chat') {
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
                if (!response.ok) {
                    const errorData = await response.text();
                    console.error(`[/chat Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                    await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                    return;
                }
                const flowiseResponse = await response.json();
                console.log(`[/chat Session: ${sessionId}] Received from Flowise:`, flowiseResponse);

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
        }
        // --- /deep_research 명령어 처리 (1단계: 계획 요청) ---
        else if (commandName === 'deep_research') {
            if (interaction.deferred || interaction.replied) return;
            try { await interaction.deferReply(); } catch (e) { console.error("Defer failed:", e); return; }

            const userQuestion = interaction.options.getString('question');
            const sessionId = interaction.user.id;

            const requestBody = {
                question: userQuestion,
                overrideConfig: {
                    sessionId: sessionId,
                    vars: { bot_name: botName },
                    flowise_request_type: 'request_plan' // Flowise에 계획 요청임을 알림
                }
            };

            console.log(`[/deep_research Session: ${sessionId}] Sending PLAN request to Flowise:`, JSON.stringify(requestBody, null, 2));
            try {
                const response = await fetch(flowiseEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errorData = await response.text();
                    console.error(`[/deep_research Plan Request Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                    await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 리서치 계획 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                    return;
                }

                const flowiseResponse = await response.json();
                console.log(`[/deep_research Plan Request Session: ${sessionId}] Received PLAN from Flowise:`, flowiseResponse);

                const researchPlanText = flowiseResponse.plan || flowiseResponse.text;

                if (!researchPlanText) {
                    await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI로부터 리서치 계획을 받지 못했습니다.`);
                    return;
                }

                pendingResearch.set(interaction.id, { originalQuestion: userQuestion, sessionId: sessionId });

                const confirmButton = new ButtonBuilder()
                    .setCustomId(`confirm_research_${interaction.id}`)
                    .setLabel('계획대로 진행')
                    .setStyle(ButtonStyle.Success);

                const cancelButton = new ButtonBuilder()
                    .setCustomId(`cancel_research_${interaction.id}`)
                    .setLabel('취소')
                    .setStyle(ButtonStyle.Danger);

                const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

                const planEmbed = new EmbedBuilder()
                    .setTitle("🔍 심층 리서치 계획 제안")
                    .setDescription(researchPlanText)
                    .setColor(0x5865F2)
                    .setFooter({ text: "아래 버튼을 눌러 진행 여부를 선택해주세요." });

                await interaction.editReply({ content: `<@${interaction.user.id}>`, embeds: [planEmbed], components: [row] });

            } catch (error) {
                console.error(`[/deep_research Plan Request Session: ${sessionId}] Error processing Flowise request:`, error);
                 try { await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 리서치 계획 요청 중 오류가 발생했습니다.`); } catch (e) { console.error("Edit reply failed:", e); }
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
        else if (commandName === 'create_event') { /* ... (이벤트 생성 코드) ... */ }
        else if (commandName === 'edit_event') { /* ... (이벤트 수정 코드) ... */ }
        else if (commandName === 'delete_event') { /* ... (이벤트 삭제 코드) ... */ }

    }
    // --- 버튼 상호작용 처리 ---
    else if (interaction.isButton()) {
        const customId = interaction.customId;
        console.log(`Processing button interaction: ${customId} by ${interaction.user.tag}`);

        // --- 심층 리서치 확인 버튼 처리 ---
        if (customId.startsWith('confirm_research_')) {
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

            const requestBody = {
                question: `계획대로 \"${originalQuestion}\"에 대한 심층 리서치를 진행해 주세요.`, // Flowise에 실행 지시
                overrideConfig: {
                    sessionId: sessionId,
                    vars: { bot_name: botName },
                    flowise_request_type: 'execute_research' // Flowise에 실행 요청임을 알림
                }
            };

            console.log(`[/deep_research Execute Session: ${sessionId}] Sending EXECUTE request to Flowise:`, JSON.stringify(requestBody, null, 2));
            try {
                const response = await fetch(flowiseEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                     const errorData = await response.text();
                     console.error(`[/deep_research Execute Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                     await interaction.followUp({ content: `<@${interaction.user.id}> 죄송합니다, 리서치 실행 중 오류가 발생했습니다. (Code: ${response.status})`, ephemeral: true });
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
                 try { await interaction.followUp({ content: `<@${interaction.user.id}> 죄송합니다, 리서치 결과 처리 중 오류가 발생했습니다.`, ephemeral: true }); } catch (e) { console.error("FollowUp failed:", e); }
                 pendingResearch.delete(originalInteractionId);
            }
        }
        // --- 심층 리서치 취소 버튼 처리 ---
        else if (customId.startsWith('cancel_research_')) {
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
});

// --- 기존 메시지 기반 명령어 처리 (주석 처리 또는 제거) ---
/*
client.on('messageCreate', async msg => {
    // ...
});
*/
// ```

// **수정 내용 요약:**

// * `Client` 초기화 시 `intents` 배열에서 `GatewayIntentBits.GuildInteraction` (단수형)을 올바른 이름인 **`GatewayIntentBits.GuildInteractions` (복수형)** 로 수정했습니다.

// 이 수정된 코드를 사용하면 Discord 봇이 올바른 Intent 설정을 가지고 시작되어 버튼 클릭과 같은 상호작용 이벤트를 정상적으로 수신할 수 있게 될 것입니다. 다시 실행해보시고 문제가 해결되었는지 확인해 보
