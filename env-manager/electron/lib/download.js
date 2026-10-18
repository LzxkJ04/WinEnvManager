'use strict'
/**
 * 下载引擎：支持进度回调、暂停 / 继续 / 取消、断点续传、下载完成后哈希校验
 */
const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { URL } = require('node:url')

const MAX_REDIRECTS = 6
const UA = 'WinEnvManager/1.0 (+https://winenv.local)'

function hashFile(file, algo = 'sha256') {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo)
    const s = fs.createReadStream(file)
    s.on('error', reject)
    s.on('data', (d) => h.update(d))
    s.on('end', () => resolve(h.digest('hex')))
  })
}

function requestFollow(urlStr, headers, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) return reject(new Error('重定向次数过多'))
    let u
    try {
      u = new URL(urlStr)
    } catch (err) {
      return reject(new Error(`下载地址无效：${urlStr}`))
    }
    const mod = u.protocol === 'http:' ? http : https
    const req = mod.request(
      u,
      {
        method: 'GET',
        headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
        timeout: 30000
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume()
          const next = new URL(res.headers.location, u).toString()
          return resolve(requestFollow(next, headers, redirects + 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage || ''}`))
        }
        resolve(res)
      }
    )
    req.on('timeout', () => req.destroy(new Error('连接超时')))
    req.on('error', reject)
    req.end()
  })
}

/**
 * 下载文件
 * @param {{url:string, dest:string, sha256?:string, signal:{paused:boolean,cancelled:boolean},
 *          onProgress?:(p:{received:number,total:number,speed:number})=>void}} opt
 */
async function downloadFile(opt) {
  const { url, dest, signal = { paused: false, cancelled: false } } = opt
  fs.mkdirSync(path.dirname(dest), { recursive: true })

  let received = 0
  if (fs.existsSync(dest)) received = fs.statSync(dest).size

  let res
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (signal.cancelled) throw new Error('任务已取消')
    while (signal.paused) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 400))
      if (signal.cancelled) throw new Error('任务已取消')
    }
    try {
      const headers = received > 0 ? { Range: `bytes=${received}-` } : {}
      res = await requestFollow(url, headers)
      break
    } catch (err) {
      if (attempt === 3) throw err
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }

  const totalHeader = Number(res.headers['content-length'] || 0)
  const total = totalHeader > 0 ? totalHeader + received : 0
  const statusPartial = res.statusCode === 206

  const stream = fs.createWriteStream(dest, {
    flags: statusPartial && received > 0 ? 'a' : 'w'
  })
  if (!(statusPartial && received > 0)) received = 0

  let lastTime = Date.now()
  let lastReceived = 0
  let speed = 0

  res.on('data', (chunk) => {
    received += chunk.length
    const now = Date.now()
    if (now - lastTime >= 400) {
      speed = ((received - lastReceived) / (now - lastTime)) * 1000
      lastTime = now
      lastReceived = received
      if (opt.onProgress) opt.onProgress({ received, total, speed })
    }
  })

  await new Promise((resolve, reject) => {
    res.on('error', reject)
    stream.on('error', reject)
    stream.on('finish', resolve)
    res.pipe(stream)
  })

  if (opt.onProgress) opt.onProgress({ received, total: total || received, speed: 0 })

  const size = fs.statSync(dest).size
  const sha256 = await hashFile(dest, 'sha256')
  const md5 = await hashFile(dest, 'md5')

  if (opt.sha256 && opt.sha256.toLowerCase() !== sha256.toLowerCase()) {
    fs.rmSync(dest, { force: true })
    throw new Error('文件哈希校验失败，已删除下载文件（可能损坏或被篡改）')
  }

  return { file: dest, size, sha256, md5 }
}

module.exports = { downloadFile, hashFile }
