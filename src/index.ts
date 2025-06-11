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
                const body: { topic?: string } = await request.json();
                const topic = body.topic;

                if (!topic) {
                    return new Response(JSON.stringify({ error: 'موضوعی دریافت نشد.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }

                console.log("Searching Google for top titles with Persian/Iran context...");
                const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_API_KEY}&cx=${env.GOOGLE_CSE_ID}&q=${encodeURIComponent(topic)}&num=5&gl=ir&hl=fa`;
                
                const searchResponse = await fetch(searchUrl);
                if (!searchResponse.ok) {
                    const errorText = await searchResponse.text();
                    throw new Error(`خطا در ارتباط با Google Search API: ${errorText}`);
                }
                const searchData: any = await searchResponse.json();
                
                const topTitles = searchData.items?.map((item: any) => item.title) || [];
                console.log("Top titles found:", topTitles);
                
                if (topTitles.length === 0) {
                    throw new Error("هیچ عنوانی از طریق جستجوی گوگل یافت نشد.");
                }

                const richPrompt = `
                    You are a world-class SEO expert and copywriter.
                    A user wants a blog post title for the topic: "${topic}".

                    The current top 5 ranking titles on Google for this topic are:
                    ${topTitles.map((title, index) => `${index + 1}. ${title}`).join('\n')}

                    Analyze these titles to understand the user's intent. Then, create a new, unique, and highly compelling title that is better than all of them. The title must be SEO-optimized. Return only the title and nothing else.
                `;
                
                const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`;
                
                const geminiResponse = await fetch(GEMINI_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        // --- این خط اصلاح شد ---
                        contents: [{ parts: [{ text: richPrompt }] }]
                    })
                });

                if (!geminiResponse.ok) {
                    const errorText = await geminiResponse.text();
                    throw new Error(`خطا در ارتباط با Gemini API: ${errorText}`);
                }

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
                return new Response(JSON.stringify({ error: error.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
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