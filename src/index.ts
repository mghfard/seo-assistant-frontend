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
                // دریافت ساختار جدید از فرانت‌اند
                const briefData: { headers?: string[], rowData?: any[] } = await request.json();

                if (!briefData.headers || !briefData.rowData || briefData.headers.length !== briefData.rowData.length) {
                    throw new Error("داده‌های ارسالی از بریف ناقص یا نامعتبر است.");
                }

                // ساخت یک بریف ساختاریافته از دو آرایه
                let structuredBrief = "Here is the content brief:\n";
                let topic = "";
                for (let i = 0; i < briefData.headers.length; i++) {
                    const header = briefData.headers[i];
                    const data = briefData.rowData[i];
                    structuredBrief += `- ${header}: ${data}\n`;
                    // پیدا کردن موضوع اصلی برای جستجوی گوگل (با فرض اینکه یکی از کلمات 'topic', 'عنوان', 'موضوع' در آن باشد)
                    if (header.toLowerCase().includes('topic') || header.includes('عنوان') || header.includes('موضوع')) {
                        topic = data;
                    }
                }

                if (!topic) {
                    throw new Error("ستون مربوط به موضوع اصلی (topic/عنوان/موضوع) در فایل شما یافت نشد.");
                }
                
                console.log("Searching Google for top titles with Persian/Iran context...");
                const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_API_KEY}&cx=${env.GOOGLE_CSE_ID}&q=${encodeURIComponent(topic)}&num=5&gl=ir&hl=fa`;
                
                const searchResponse = await fetch(searchUrl);
                if (!searchResponse.ok) throw new Error(`خطا در ارتباط با Google Search API`);
                
                const searchData: any = await searchResponse.json();
                const topTitles = searchData.items?.map((item: any) => item.title) || [];
                if (topTitles.length === 0) throw new Error("هیچ عنوانی از طریق جستجوی گوگل یافت نشد.");
                console.log("Top titles found:", topTitles);

                const richPrompt = `
                    You are a world-class SEO expert and copywriter.
                    A user has provided a detailed brief for a blog post. First, understand the brief:
                    ---
                    ${structuredBrief}
                    ---
                    The current top 5 ranking titles on Google for the main topic are:
                    ${topTitles.map((title, index) => `${index + 1}. ${title}`).join('\n')}

                    Based on ALL the information in the brief (like tone, keywords, etc.) and your analysis of the competing titles, create a new, unique, and highly compelling title. 
                    Return only the title and nothing else.
                `;
                
                const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`;
                
                const geminiResponse = await fetch(GEMINI_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: richPrompt }] }] })
                });

                if (!geminiResponse.ok) throw new Error(`خطا در ارتباط با Gemini API`);

                const geminiData: any = await geminiResponse.json();
                const generatedText = geminiData.candidates[0].content.parts[0].text;
                
                return new Response(JSON.stringify({ 
                    generated_title: generatedText.trim(),
                    source_titles: topTitles 
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