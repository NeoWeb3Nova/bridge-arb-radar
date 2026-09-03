'use strict';

/**
 * EventBroadcaster - 轻量 Server-Sent Events (SSE) 事件总线
 * 管理所有客户端的长连接并广播实时事件（扫描进度、发现套利机会、钱包动态）
 */
class EventBroadcaster {
  constructor() {
    /** @type {Set<import('http').ServerResponse>} */
    this.clients = new Set();
  }

  /**
   * 挂载一个客户端 SSE 响应流
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   */
  addClient(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // 握手包，告知已就绪
    res.write(`event: connected\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);
    this.clients.add(res);

    req.on('close', () => {
      this.clients.delete(res);
    });
  }

  /**
   * 广播指定类型的事件到所有在线客户端
   * @param {string} eventName 事件名 (如 scan_status, arb_found, log)
   * @param {any} data 数据载荷
   */
  broadcast(eventName, data) {
    if (this.clients.size === 0) return;
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  /**
   * 发送心跳包防止反向代理/网关断开连接
   */
  heartbeat() {
    if (this.clients.size === 0) return;
    for (const client of this.clients) {
      try {
        client.write(': heartbeat\n\n');
      } catch {
        this.clients.delete(client);
      }
    }
  }
}

const events = new EventBroadcaster();

// 每 25s 发送一次注释心跳包
setInterval(() => events.heartbeat(), 25000).unref?.();

module.exports = events;
