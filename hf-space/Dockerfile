FROM node:22-alpine
WORKDIR /app
COPY server.js /app/server.js
# البيانات تُنزَّل من GitHub عند كل تشغيل، فتبقى محدّثة تلقائيًا
ENV DATA_PATH=/app/none \
    DATA_URL=https://raw.githubusercontent.com/mohannad786777/musaylima/main/data.json.gz \
    PORT=7860 \
    NODE_ENV=production
EXPOSE 7860
CMD ["node", "/app/server.js"]
