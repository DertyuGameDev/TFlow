FROM node:22-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.mts postcss.config.mjs ./
COPY app ./app
COPY src ./src
COPY lib ./lib
COPY backend/flow/interest_categories.json ./backend/flow/interest_categories.json
COPY public ./public
RUN npm run check && npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DJANGO_DEBUG=0
WORKDIR /app
COPY backend/requirements.lock.txt /app/requirements.lock.txt
RUN pip install --no-cache-dir -r /app/requirements.lock.txt
COPY backend /app/backend
COPY public /app/public
COPY --from=frontend /build/dist /app/dist
RUN DJANGO_SECRET_KEY=build-only-placeholder-not-a-runtime-key python backend/manage.py collectstatic --noinput && \
    useradd --create-home --uid 10001 tflow && chown -R tflow:tflow /app/backend/data
USER tflow
EXPOSE 8000
VOLUME ["/app/backend/data"]
CMD ["python", "backend/entrypoint.py"]
