ARG ADMIN_PASSWORD
ARG SECRET
ARG ME
ARG MASTODON_USER
ARG MASTODON_ACCESS_TOKEN

FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD [ "npm", "start" ]
