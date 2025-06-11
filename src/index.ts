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
                const briefData: { headers?: string[], rowData?: any[] } = await request.json();

                if (!briefData.headers || !briefData.rowData) {
                    throw new Error("داده‌های بریف ناقص است.");
                }

                let structuredBrief = "";
                let topic = "";
                for (let i = 0; i < briefData.headers.length; i++) {
                    const header = briefData.headers[i];
                    const data = briefData.rowData[i];
                    structuredBrief += `- ${header}: ${data}\n`;
                    if (header.toLowerCase().includes('topic') || header.includes('عنوان') || header.includes('موضوع')) {
                        topic = data;
                    }
                }

                if (!topic) {
                    throw new Error("ستون مربوط به موضوع اصلی (topic/عنوان/موضوع) در فایل شما یافت نشد.");
                }
                
                // --- مرحله ۱: جستجو در گوگل ---
                console.log("Searching Google for top titles...");
                const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_API_KEY}&cx=${env.GOOGLE_CSE_ID}&q=${encodeURIComponent(topic)}&num=5&gl=ir&hl=fa`;
                const searchResponse = await fetch(searchUrl);
                if (!searchResponse.ok) throw new Error(`خطا در ارتباط با Google Search API`);
                const searchData: any = await searchResponse.json();
                const topTitles = searchData.items?.map((item: any) => item.title) || [];
                if (topTitles.length === 0) throw new Error("هیچ عنوانی از طریق جستجوی گوگل یافت نشد.");
                console.log("Top titles found:", topTitles);

                // --- مرحله ۲: دریافت پیشنهاد از جمینی ---
                const geminiPrompt = `
                    Based on the main topic "${topic}" and the following top 5 ranking Google titles:
                    ${topTitles.map((title, index) => `${index + 1}. ${title}`).join('\n')}

                    Please suggest one new, unique, and SEO-optimized title. Return only the title text and nothing else.
                `;
                
                const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`;
                
                const geminiResponse = await fetch(GEMINI_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: geminiPrompt }] }] })
                });

                if (!geminiResponse.ok) throw new Error(`خطا در ارتباط با Gemini API`);

                const geminiData: any = await geminiResponse.json();
                const aiSuggestedTitle = geminiData.candidates[0].content.parts[0].text;
                
                // --- مرحله ۳: ارسال پاسخ کامل به فرانت‌اند ---
                return new Response(JSON.stringify({ 
                    original_topic: topic,
                    source_titles: topTitles,
                    ai_suggested_title: aiSuggestedTitle.trim()
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });

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