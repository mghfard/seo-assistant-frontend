export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        if (request.method === 'POST') {
            try {
                const body: { task?: string; brief?: any; top_titles?: string[]; final_title?: string; outline?: string; } = await request.json();
                const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`;

                if (body.task === 'get_title_suggestions') {
                    const brief = body.brief;
                    if (!brief || !brief.headers || !brief.rowData) throw new Error("بریف ناقص است.");

                    let topic = "";
                    for (let i = 0; i < brief.headers.length; i++) {
                        const header = brief.headers[i];
                        if (header.toLowerCase().includes('topic') || header.includes('عنوان') || header.includes('موضوع')) {
                            topic = brief.rowData[i];
                            break;
                        }
                    }
                    if (!topic) throw new Error("ستون موضوع اصلی در فایل اکسل یافت نشد.");

                    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_API_KEY}&cx=${env.GOOGLE_CSE_ID}&q=${encodeURIComponent(topic)}&num=5&gl=ir&hl=fa`;
                    const searchResponse = await fetch(searchUrl);
                    if (!searchResponse.ok) throw new Error(`خطا در ارتباط با Google Search API`);
                    
                    const searchData: any = await searchResponse.json();
                    const topTitles = searchData.items?.map((item: any) => item.title) || [];
                    if (topTitles.length === 0) throw new Error("هیچ عنوانی از طریق جستجوی گوگل یافت نشد.");

                    const titlePrompt = `Based on the main topic "${topic}" and the following top 5 ranking Google titles:\n${topTitles.join('\n')}\n\nPlease suggest one new, unique, and SEO-optimized title. Return only the title text.`;
                    
                    const geminiResponse = await fetch(GEMINI_API_URL, { body: JSON.stringify({ contents: [{ parts: [{ text: titlePrompt }] }] }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
                    if (!geminiResponse.ok) throw new Error(`خطا در ارتباط با Gemini API`);

                    const geminiData: any = await geminiResponse.json();
                    const aiSuggestedTitle = geminiData.candidates[0].content.parts[0].text;
                    
                    return new Response(JSON.stringify({ original_topic: topic, source_titles: topTitles, ai_suggested_title: aiSuggestedTitle.trim() }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                else if (body.task === 'generate_outline') {
                    const { brief, final_title, top_titles } = body;
                    if (!brief || !final_title || !top_titles) throw new Error("اطلاعات لازم برای تولید سرفصل ناقص است.");

                    let structuredBrief = "";
                    for (let i = 0; i < brief.headers.length; i++) structuredBrief += `- ${brief.headers[i]}: ${brief.rowData[i]}\n`;
                    
                    const outlinePrompt = `You are an expert SEO content strategist writing in Persian. Create a comprehensive blog post outline. CONTEXT: - Final Title: "${final_title}" - Brief: \n${structuredBrief} - Competing Titles: \n${top_titles.join('\n')} INSTRUCTIONS: - Generate a logical outline using Persian Markdown headings (## for H2, ### for H3). - The outline must be detailed enough for a long-form article. - Return ONLY the Markdown outline in Persian.`;
                    
                    const geminiResponse = await fetch(GEMINI_API_URL, { body: JSON.stringify({ contents: [{ parts: [{ text: outlinePrompt }] }] }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
                    if (!geminiResponse.ok) throw new Error(`خطا در ارتباط با Gemini API برای تولید سرفصل`);

                    const geminiData: any = await geminiResponse.json();
                    const generatedOutline = geminiData.candidates[0].content.parts[0].text;

                    return new Response(JSON.stringify({ generated_outline: generatedOutline }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                else if (body.task === 'generate_article') {
                    const { brief, final_title, outline } = body;
                    if (!brief || !final_title || !outline) throw new Error("اطلاعات لازم برای تولید مقاله کامل ناقص است.");

                    let structuredBrief = "";
                    for (let i = 0; i < brief.headers.length; i++) structuredBrief += `- ${brief.headers[i]}: ${brief.rowData[i]}\n`;

                    const articlePrompt = `
                        You are a professional SEO content writer and expert in your field. Your task is to write a complete, comprehensive, and engaging blog post in Persian.
                        
                        ALL INFORMATION FOR THE ARTICLE:
                        1.  Final Approved Title: "${final_title}"
                        2.  Content Brief:
                        ${structuredBrief}
                        3.  The exact article structure to follow (Outline):
                        ${outline}

                        DETAILED INSTRUCTIONS:
                        - Write the entire article in fluent, natural, and engaging Persian.
                        - You MUST follow the provided outline exactly. Use all the H2 and H3 headings from the outline in your article.
                        - Write clear and concise paragraphs.
                        - Naturally incorporate the keywords from the brief into the text.
                        - The final article should be comprehensive enough to match the word count specified in the brief.
                        - Return ONLY the full text of the article. Do not include any extra notes, comments, or introductions. Start directly with the first paragraph after the title.
                    `;

                    const geminiResponse = await fetch(GEMINI_API_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: articlePrompt }] }] })
                    });
                     if (!geminiResponse.ok) throw new Error(`خطا در ارتباط با Gemini API برای تولید مقاله`);

                    const geminiData: any = await geminiResponse.json();
                    const generatedArticle = geminiData.candidates[0].content.parts[0].text;

                    return new Response(JSON.stringify({ generated_article: generatedArticle }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                else {
                    throw new Error("وظیفه نامشخص است.");
                }
            } catch (error: any) {
                console.error("Error in worker:", error);
                return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
            }
        }
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    },
};

interface Env {
    GEMINI_API_KEY: string;
    GOOGLE_API_KEY: string;
    GOOGLE_CSE_ID: string;
}