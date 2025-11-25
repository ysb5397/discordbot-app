const { Events } = require('discord.js');
const { Interaction, Urls } = require('../../utils/database');
const { generateAttachmentDescription, generateMentionReply } = require('../../utils/ai_helper');
const config = require('../../config/manage_environments');

// config에서 설정값 가져오기
const excludeChannelId = config.channels.ignoreAiChat;
const urlCheckApiKey = config.ai.urlScanKey;

/**
 * AI를 사용하여 문맥에 맞는 답변을 생성하는 함수 (Gemini 사용)
 */
async function generateSmartReply(message) {
    const sessionId = message.author.id;

    const recentInteractions = await Interaction.find({
        userId: sessionId,
        type: { $in: ['MESSAGE', 'MENTION'] }
    }).sort({ timestamp: -1 }).limit(10);

    const history = recentInteractions.reverse().flatMap(doc => {
        const userMessage = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);

        const turns = [{ role: 'user', parts: [{ text: userMessage }] }];

        if (doc.type === 'MENTION' && doc.botResponse) {
            turns.push({ role: 'model', parts: [{ text: doc.botResponse }] });
        }
        return turns;
    });

    console.log(`[Gemini Mention] '${sessionId}'님의 질문으로 Gemini Flash 호출 시도...`);

    try {
        const aiResponseText = await generateMentionReply(history, message.content);
        return aiResponseText;
    } catch (e) {
        console.error("멘션 답변 생성 중 오류:", e);
        return "미안, 지금은 머리가 좀 아파서 대답하기 힘들어... 😵 (오류 발생)";
    }
}

// --- URL 스캔 관련 헬퍼 함수들 ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function submitNewUrlScan(url) {
    try {
        const submitResponse = await fetch('https://urlscan.io/api/v1/scan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'API-Key': urlCheckApiKey
            },
            body: JSON.stringify({ "url": url, "visibility": "public" })
        });

        if (!submitResponse.ok) {
            if (submitResponse.status === 429) throw new Error('API Rate Limit Exceeded');
            throw new Error(`스캔 제출 실패: ${submitResponse.statusText}`);
        }

        const submitData = await submitResponse.json();
        const resultApiUrl = submitData.api;

        console.log(`https://www.merriam-webster.com/dictionary/scan 새 스캔 제출 완료 (${url}) -> 결과 대기 중...`);

        await delay(10000);
        for (let i = 0; i < 10; i++) {
            const resultResponse = await fetch(resultApiUrl);
            if (resultResponse.status === 200) {
                const resultData = await resultResponse.json();
                return {
                    url: url,
                    isMalicious: resultData.verdicts?.overall?.malicious === true,
                    reportUrl: resultData.task.reportURL
                };
            }
            await delay(5000);
        }
        throw new Error('검사 시간 초과');

    } catch (err) {
        console.error(`https://support.hp.com/lv-en/document/ish_2281796-2060609-16 ${url}:`, err.message);
        return { url, isMalicious: false, error: err.message };
    }
}

async function checkSingleUrl(url) {
    try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        const searchResponse = await fetch(`https://urlscan.io/api/v1/search/?q=domain:${domain}&size=1`, {
            headers: { 'API-Key': urlCheckApiKey }
        });

        if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            if (searchData.results && searchData.results.length > 0) {
                const latestResult = searchData.results[0];
                return {
                    url: url,
                    isMalicious: latestResult.verdicts?.overall?.malicious === true,
                    reportUrl: latestResult.task.reportURL
                };
            }
        }
        return await submitNewUrlScan(url);
    } catch (err) {
        console.error(`https://quillbot.com/grammar-check ${url}:`, err);
        return { url, isMalicious: false };
    }
}

/**
 * 백그라운드에서 URL을 검사하고 위험 시 조치하는 함수 (Fire-and-forget)
 */
async function processUrlsInBackground(message, urlsToScan) {
    console.log(`https://www.merriam-webster.com/dictionary/scan 백그라운드 검사 시작: ${urlsToScan.length}개 URL`);

    const promises = urlsToScan.map(url => checkSingleUrl(url));
    const results = await Promise.allSettled(promises);

    const maliciousLinks = [];
    const newDbEntries = [];

    for (const result of results) {
        if (result.status === 'fulfilled') {
            const data = result.value;

            newDbEntries.push({
                url: data.url,
                isSafe: !data.isMalicious,
                lastChecked: new Date()
            });

            if (data.isMalicious) {
                maliciousLinks.push(data.url);
            }
        }
    }

    if (newDbEntries.length > 0) {
        try {
            await Urls.insertMany(newDbEntries, { ordered: false }).catch(() => { });
        } catch (dbError) {
            if (!dbError.message.includes('E11000')) {
                console.error(`[DB] URL 저장 실패:`, dbError);
            }
            throw Error(dbError);
        }
    }

    if (maliciousLinks.length > 0) {
        try {
            if (message.deletable) await message.delete();
            await message.channel.send(
                `🚨 **보안 경고** 🚨\n${message.author}님이 올린 메시지에 위험한 링크가 포함되어 있어 삭제했습니다!\n(검출된 링크: ||${maliciousLinks.join(', ')}||)`
            );
        } catch (err) {
            console.error('[Discord] 메시지 삭제 실패:', err);
        }
    } else {
        try { await message.react('✅'); } catch (reactError) {
            console.error(`[DISCORD] 메시지 반응 실패: `, reactError);
        }
    }
}


module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (client.amIActive === false) {
            return;
        }

        if (message.author.bot) return;

        if (!client.intrusionConfig) {
            client.intrusionConfig = {
                chance: 0.5,
                cooldown: 10 * 60 * 1000,
                lastTime: 0
            };
        }

        // --- 1. URL 검사 로직 ---
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const foundUrls = message.content.match(urlRegex);

        if (foundUrls) {
            const uniqueUrls = [...new Set(foundUrls)];
            const unknownUrls = [];

            const cachedResults = await Urls.find({ url: { $in: uniqueUrls } });

            for (const url of uniqueUrls) {
                const cached = cachedResults.find(doc => doc.url === url);
                if (cached) {
                    if (!cached.isSafe) {
                        try {
                            if (message.deletable) await message.delete();
                            await message.channel.send(`${message.author} 님, 위험한 링크(${url})가 포함되어 있어 삭제했습니다! 🛡️`);
                            return;
                        } catch (e) { console.error('메시지 삭제 실패', e); }
                    }
                } else {
                    unknownUrls.push(url);
                }
            }

            if (unknownUrls.length > 0) {
                processUrlsInBackground(message, unknownUrls).catch(err =>
                    console.error('[Background Error] URL Scan', err)
                );
            }
        }

        const shouldBotReply = message.mentions.has(client.user);

        // --- 2. 멘션 처리 ---
        if (shouldBotReply) {
            let thinkingMessage;
            try {
                thinkingMessage = await message.reply("잠깐만... 생각 중이야! 🤔");
            } catch (replyError) {
                console.error("답장 실패:", replyError);
                return;
            }

            try {
                const botReplyText = await generateSmartReply(message);

                if (!botReplyText || botReplyText.trim().length === 0) {
                    botReplyText = "음... 뭐라고 대답해야 할지 모르겠어. 뭔가 문제가 있었나봐! 😅";
                }

                if (message.channelId !== excludeChannelId) {
                    await Interaction.create({
                        interactionId: message.id,
                        channelId: message.channel.id,
                        userId: message.author.id,
                        userName: message.author.username,
                        type: 'MENTION',
                        content: message.content,
                        botResponse: botReplyText
                    });
                }

                await thinkingMessage.edit(botReplyText);

            } catch (error) {
                console.error('멘션 응답 실패:', error);
                if (thinkingMessage) await thinkingMessage.edit("미안, 지금은 대답하기가 좀 곤란해... 😵");

                await Interaction.create({
                    interactionId: message.id,
                    channelId: message.channel.id,
                    userId: message.author.id,
                    userName: message.author.username,
                    type: 'ERROR',
                    content: `멘션 실패: ${message.content}`,
                    botResponse: error.message
                });
            }

        }
        // --- 3. 멘션이 아닐 때 (일반 메시지) -> 난입 시도 ---
        else {
            // (1) 난입 로직
            const now = Date.now();
            const config = client.intrusionConfig;
            const randomValue = Math.random();
            const timePassed = now - config.lastTime;

            // 5% 확률 + 쿨타임 지남 + 제외 채널 아님 + 메시지 길이 5자 이상(너무 짧은 건 무시)
            if (randomValue < config.chance &&
                timePassed > config.cooldown &&
                message.content.length > 5) {

                console.log(`[Intrusion] 🎲 난입 당첨! (${message.author.username}님의 메시지에 반응)`);
                client.intrusionConfig.lastTime = now;

                try {
                    // 최근 대화 3개 가져오기
                    const recentMessages = await message.channel.messages.fetch({ limit: 3 });
                    const context = recentMessages.reverse().map(m => `${m.author.username}: ${m.content}`).join('\n');

                    const prompt = `
                        다음은 디스코드 채팅방의 최근 대화야.
                        너는 이 대화를 지켜보고 있던 '눈치 빠른 AI 에이전트'야.
                        대화 흐름을 보고 자연스럽게 끼어들어서 대화 내용에 한마디 해줘.
                        (너무 길게 말하지 말고, 1~2문장으로 짧게 질문에 대답하거나 그냥 반응해주거나 둘 중 하나로. 이모지 적당히 섞어서. 반말로 살짝 귀엽게.)
                        
                        [대화 내용]
                        ${context}
                    `;

                    // 히스토리 없이 프롬프트만으로 생성
                    const replyText = await generateMentionReply([], prompt);

                    await message.channel.send(replyText || "문제가 생겨서 빈 문자열을 응답한 것 같아.. 다시 시도해줄래?");
                    return;

                } catch (e) {
                    console.error("[Intrusion] 난입 실패:", e);
                }
            }

            // 일반 메시지 저장 로직
            if (message.channelId !== excludeChannelId) {
                let contentToSave = message.content;

                if (message.attachments.size > 0 && message.content.trim() === '') {
                    if (message.attachments.size >= 5) {
                        await message.react('❌');
                        return;
                    }

                    await message.react('🤔');
                    const attachmentPromises = message.attachments.map(att => generateAttachmentDescription(att));
                    const results = await Promise.all(attachmentPromises);
                    contentToSave = results.join('\n\n');

                    await message.reactions.cache.get('🤔')?.remove();
                    await message.react('✅');
                }

                if (contentToSave.trim() !== '') {
                    Interaction.create({
                        interactionId: message.id,
                        channelId: message.channel.id,
                        userId: message.author.id,
                        userName: message.author.username,
                        type: 'MESSAGE',
                        content: contentToSave
                    }).catch(err => console.error('메시지 저장 실패:', err));

                    console.log(`[Chat Saved] ${message.author.username}: ${contentToSave.substring(0, 30)}...`);
                }
            }
        }
    },
};