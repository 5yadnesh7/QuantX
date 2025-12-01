FROM node:18-alpine

WORKDIR /app

ENV PATH /app/node_modules/.bin:$PATH

COPY frontend/package.json frontend/package-lock.json* ./ 

RUN npm install --legacy-peer-deps

COPY frontend ./frontend

WORKDIR /app/frontend

ENV PORT=3021

EXPOSE 3021

CMD ["npm", "start"]
