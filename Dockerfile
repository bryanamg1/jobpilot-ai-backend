FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=4300

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Instalar Chromium y dependencias necesarias
RUN npx playwright install --with-deps chromium

COPY . .

EXPOSE 4300

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
CMD node -e "fetch('http://127.0.0.1:4300/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["sh","-c","if [ \"$RUN_DB_MIGRATIONS_ON_BOOT\" = \"true\" ]; then npm run db:migrate; fi && npm start"]