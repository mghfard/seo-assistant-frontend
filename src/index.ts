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
                // از فرانت‌اند یک وظیفه (task) و داده‌های مربوط به آن را دریافت می‌کنیم
                const body: { task?: string; brief?: any; top_titles?: string[]; final_title?: string } = await request.json();

                // --- تعریف API های مورد نیاز ---
                const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`;


                // ============== وظیفه اول: تولید پیشنهاد عنوان ==============
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
                    
                    const geminiResponse = await fetch(GEMINI_API_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: titlePrompt }] }] })
                    });
                    if (!geminiResponse.ok) throw new Error(`خطا در ارتباط با Gemini API`);

                    const geminiData: any = await geminiResponse.json();
                    const aiSuggestedTitle = geminiData.candidates[0].content.parts[0].text;
                    
                    return new Response(JSON.stringify({ 
                        original_topic: topic,
                        source_titles: topTitles,
                        ai_suggested_title: aiSuggestedTitle.trim()
                    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }

                // ============== وظیفه دوم: تولید سرفصل‌ها ==============
                else if (body.task === 'generate_outline') {
                    const brief = body.brief;
                    const final_title = body.final_title;
                    const top_titles = body.top_titles;

                    if (!brief || !final_title || !top_titles) throw new Error("اطلاعات لازم برای تولید سرفصل ناقص است.");

                    let structuredBrief = "Here is the content brief:\n";
                    for (let i = 0; i < brief.headers.length; i++) {
                        structuredBrief += `- ${brief.headers[i]}: ${brief.rowData[i]}\n`;
                    }
                    
                    const outlinePrompt = `
                        You are an expert SEO content strategist. Create a comprehensive, well-structured blog post outline.
                        CONTEXT:
                        - Final Approved Title: "${final_title}"
                        - Original Content Brief: \n${structuredBrief}
                        - Competing Google Titles: \n${top_titles.join('\n')}

                        INSTRUCTIONS:
                        - Generate a logical outline using Markdown headings (## for H2, ### for H3).
                        - The outline should be detailed enough to write a long-form article.
                        - Include an introduction, several main body sections with sub-points, and a conclusion.
                        - Return ONLY the Markdown outline.
                    `;

                    const geminiResponse = await fetch(GEMINI_API_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: outlinePrompt }] }] })
                    });
                    
                    if (!geminiResponse.ok) throw new Error(`خطا در ارتباط با Gemini API برای تولید سرفصل`);

                    const geminiData: any = await geminiResponse.json();
                    const generatedOutline = geminiData.candidates[0].content.parts[0].text;

                    return new Response(JSON.stringify({ generated_outline: generatedOutline }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
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