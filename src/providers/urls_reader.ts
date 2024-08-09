import { ChatRequest } from "../entity/chat_request"
import WebResponse from "../util/response";
import AbstractProvider from "./abstract_provider";



export default class UrlsReader extends AbstractProvider {

    constructor() {
        super();
    }

    async chat(chatRequest: ChatRequest, session_id: string, ctx: any) {
        console.log(chatRequest);
        const { localLlmModel } = this.modelData.config;
        if (!localLlmModel) {
            throw new Error("You must specify the parameter 'localLlmModel'.")
        }
        chatRequest.model = localLlmModel;
        ctx.status = 200;
        if (chatRequest.stream) {
            await this.chatStream(ctx, chatRequest, session_id);
        } else {
            ctx.set({
                'Content-Type': 'application/json',
            });
            ctx.body = await this.chatSync(ctx, chatRequest, session_id);
        }
    }

    async chatStream(ctx: any, chatRequest: ChatRequest, session_id: string) {
        const lastQ = chatRequest.messages[chatRequest.messages.length - 1];
        const q = lastQ.content;
        const urlContents = await this.fetchUrls(q);
        const prompt = this.toPrompt(q, urlContents)
        lastQ.content = prompt;
        console.log(chatRequest);
        ctx.set({
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'Content-Type': 'text/event-stream',
        });

        const response = await fetch("http://localhost:8866/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + ctx.user.api_key,
                'Session-Id': session_id
            },
            body: JSON.stringify(chatRequest)
        });

        if (!response.ok)
            throw new Error(await response.text());
        const reader = response.body.getReader();
        let done: any, value: any;
        while (!done) {
            ({ value, done } = await reader.read());
            !done && ctx.res.write(value);
        }
        // ctx.res.write("data: [DONE]\n\n")

        ctx.res.end();

    }
    async chatSync(ctx: any, chatRequest: ChatRequest, session_id: string) {
        const response = await fetch("http://localhost:8866/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + ctx.user.api_key,
                'Session-Id': session_id
            },
            body: JSON.stringify(chatRequest)
        });

        return await response.json();
    }


    async fetchUrls(input: string) {
        const urls = input.match(/(https?:\/\/[^\s]+)/g);
        if (!urls) return [];
        const resultContents = [];
        // let results = "<url_contents>\n";
        for (const url of urls) {
            // results = "  <url_content>\n";
            // results += "    <url>${url}</url>\n";
            // results += "    <content>\n";
            try {
                const response = await fetch(url);
                let text = await response.text();
                text = text
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
                    .replace(/<style\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/style>/gi, "")
                    .replace(/<[^>]*(>|$)|&nbsp;|&zwnj;|&raquo;|&laquo;|&gt;/gi, "")
                    .replace(/\n\s*\n/g, "\n");
                ;

                resultContents.push({
                    url,
                    text
                })
                // results += text;
            } catch (ex) {
                resultContents.push({
                    url,
                    text: "Fetch timeout.\n"
                })

                // results += "Fetch timeout.\n";
            }
            // results += "\n    </content>\n";
            // results += "  </url_content>\n";
        }
        return resultContents;
        // results += "</url_contents>";
        // return results;
    }

    toPrompt(q: string, result: any[]) {
        if (!result) {
            return q;
        }
        const knowledges = result.reduce((preValue, ele, currentIndex) => {
            return preValue + `
      <url_content>
        <url>${ele["url"]}</title>
        <content>${ele["text"]}</content>
      </url_content>`;;
        }, "");
        return `
You are skilled at summarizing articles. 
I know you don't have internet access, 
but I will retrieve the content from URLs in the user's question and place it within the <url_contents> tag. Please answer the user's question based on this content and the context provided by the user.
If you find that there is no actual content in <url_content>, it's possible that the URL does not allow web scraping, or the content is dynamically generated by Javascript. Please include this possibility in your response.
<url_contents>
${knowledges}
</url_contents>
    
Here is the user's question:
${q}
    `;
    }
}