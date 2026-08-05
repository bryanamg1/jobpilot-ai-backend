FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=4300
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 4300

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:4300/api/v1/health').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["sh", "-c", "if [ \"$RUN_DB_MIGRATIONS_ON_BOOT\" = \"true\" ]; then npm run db:migrate; fi && npm start"]
