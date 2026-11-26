# خادم MCP لأرشيف مسيلمة 🔌

هذا الخادم يتيح لأي مساعد ذكاء اصطناعي يدعم **MCP** (Claude وChatGPT وCursor وغيرها) أن يبحث مباشرةً في تفريغات الحلقات (2517 حلقة، 205,778 مقطعًا) ويقرأ سياقها، ويرجع برابط يوتيوب يبدأ من لحظة المقطع.

- لا يحتاج أي مكتبات، فقط **Node.js 18 أو أحدث**.
- يقرأ البيانات من `../data.json.gz` الموجود في المستودع.
- يحتاج نحو **500 ميغابايت من الذاكرة** وهو يعمل.

## الأدوات التي يراها الذكاء الاصطناعي

| الأداة | ماذا تفعل |
|---|---|
| `search_transcripts` | البحث في كل التفريغات (عبارة متتالية / كل الكلمات / أي كلمة)، مع تصفية بالتاريخ أو بالحلقة، وترتيب بالصلة أو بالأحدث. البحث يتجاهل التشكيل والهمزات والتاء المربوطة والألف المقصورة |
| `get_transcript` | قراءة نص حلقة كاملًا أو ما حول ثانية معيّنة (السياق) |
| `list_episodes` | فهرس الحلقات مع البحث في العناوين |
| `archive_stats` | عدد الحلقات وأقدم حلقة وأحدثها |

---

## الطريقة 1: على جهازك (Claude Desktop / Claude Code / Cursor)

```bash
git clone https://github.com/mohannad786777/musaylima.git
```

**Claude Desktop**: افتح *Settings ← Developer ← Edit Config* وأضف هذا إلى `claude_desktop_config.json` (غيّر المسار):

```json
{
  "mcpServers": {
    "musaylima": {
      "command": "node",
      "args": ["C:\\path\\to\\musaylima\\mcp-server\\server.js", "--stdio"]
    }
  }
}
```

ثم أعد تشغيل Claude Desktop.

**Claude Code**:

```bash
claude mcp add musaylima -- node /path/to/musaylima/mcp-server/server.js --stdio
```

**Cursor / Windsurf / VS Code**: استعمل الإعداد نفسه (`command` و`args`) في ملف `mcp.json`.

---

## الطريقة 2: رابط عن بُعد (تضيفه في claude.ai أو ChatGPT كـ Connector)

لكي تحصل على **رابط** تضيفه في الإضافات، يجب أن يعمل الخادم على الإنترنت في وضع HTTP:

```bash
cd mcp-server
MCP_TOKEN=كلمة-سرية-طويلة PORT=8787 node server.js
```

فيصير الرابط:

```
https://نطاقك/mcp/كلمة-سرية-طويلة
```

> **ضع `MCP_TOKEN` دائمًا.** الموقع نفسه محمي بكلمة مرور، وبدون هذا الرمز يستطيع أي أحد يعرف الرابط أن يقرأ الأرشيف. وما دام الرمز جزءًا من الرابط، فالرابط نفسه هو كلمة السر، فلا تنشره.

### أين تشغّله؟

**أ) Docker** (على Railway وFly.io وRender وHugging Face Spaces وأي خادم VPS). اختر خطة فيها 1 غيغابايت من الذاكرة على الأقل، وابنِ الصورة من جذر المستودع:

```bash
docker build -f mcp-server/Dockerfile -t musaylima-mcp .
```

```bash
docker run -p 8787:8787 -e MCP_TOKEN=كلمة-سرية-طويلة musaylima-mcp
```

**ب) من جهازك عبر Cloudflare Tunnel** (مجاني، ولا يحتاج خادمًا). شغّل الخادم كما في الأعلى، ثم في نافذة أخرى:

```bash
cloudflared tunnel --url http://localhost:8787
```

سيعطيك رابطًا مثل `https://xxxx.trycloudflare.com`، فيكون رابط MCP: `https://xxxx.trycloudflare.com/mcp/كلمة-سرية-طويلة`. هذا الرابط يعمل ما دام جهازك والنفق يعملان، ويتغيّر في كل مرة إلا إذا أنشأت نفقًا دائمًا.

> لماذا ليس Cloudflare Workers؟ لأن البيانات بعد فك الضغط 94 ميغابايت، وذاكرة الـ Worker محدودة بـ 128 ميغابايت.

### إضافته في claude.ai

1. *Settings ← Connectors ← Add custom connector*
2. الاسم: `أرشيف مسيلمة`، والرابط: `https://نطاقك/mcp/كلمة-سرية-طويلة`
3. اترك إعدادات OAuth فارغة، ثم *Add*.
4. في المحادثة فعّل الموصل من زر الأدوات، واسأل مثلًا: «ماذا قال عن زيت الزيتون والنقرس؟ أعطني الروابط بالتوقيت».

**ChatGPT**: *Settings ← Apps & Connectors ← Developer mode ← Create*، وضع الرابط نفسه بلا مصادقة.

### فحص سريع

```bash
curl https://نطاقك/health
```

```bash
curl -X POST https://نطاقك/mcp/كلمة-سرية-طويلة -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_transcripts","arguments":{"query":"زيت الزيتون","limit":3}}}'
```

---

## متغيرات البيئة

| المتغير | الافتراضي | المعنى |
|---|---|---|
| `PORT` | `8787` | منفذ HTTP |
| `MCP_TOKEN` | — | الرمز السري. يُقبل في الرابط `/mcp/<الرمز>` أو في الترويسة `Authorization: Bearer <الرمز>` |
| `DATA_PATH` | `../data.json.gz` | مسار ملف البيانات |
| `DATA_URL` | — | رابط لتنزيل البيانات إن لم يوجد الملف محليًا |

عند تحديث `data.json.gz` في المستودع، أعد تشغيل الخادم (أو أعد بناء صورة Docker) ليقرأ البيانات الجديدة.
