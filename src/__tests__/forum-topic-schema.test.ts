import assert from "node:assert/strict";
import { it } from "node:test";
import bigInt from "big-integer";
import { BinaryReader } from "telegram/extensions/BinaryReader.js";
import { Api } from "telegram/tl/index.js";
import { TelegramService } from "../telegram-client.js";
import { CurrentApi } from "../tl/current-schema.js";

it("uses the layer 233 messages namespace and peer for forum topic lifecycle requests", async () => {
  const channel = new Api.Channel({
    id: bigInt(100),
    accessHash: bigInt(1),
    title: "Forum",
    photo: new Api.ChatPhotoEmpty(),
    date: 1,
    megagroup: true,
    forum: true,
  });
  const calls: string[] = [];
  const service = new TelegramService(1, "hash");
  const internals = service as unknown as {
    connected: boolean;
    resolveChat: () => Promise<Api.Channel>;
    client: { invoke: (request: unknown) => Promise<unknown> };
  };
  internals.connected = true;
  internals.resolveChat = async () => channel;
  internals.client = {
    invoke: async (value) => {
      const request = value as InstanceType<typeof CurrentApi.messages.CreateForumTopic>;
      assert.equal(request.peer, channel);
      // The real client resolves Channel to InputPeer before encoding the request.
      request.peer = new Api.InputPeerChannel({ channelId: channel.id, accessHash: bigInt(1) });
      const decoded = new BinaryReader(request.getBytes()).tgReadObject();
      assert.ok(decoded.peer instanceof Api.InputPeerChannel);
      assert.equal(decoded.peer.channelId.toString(), "100");
      calls.push(decoded.className);
      if (request instanceof CurrentApi.messages.CreateForumTopic) {
        assert.equal(decoded.title, "Topic");
        assert.equal(decoded.iconEmojiId.toString(), "123");
        return new Api.Updates({
          updates: [new Api.UpdateMessageID({ id: 42, randomId: request.randomId })],
          users: [],
          chats: [],
          date: 1,
          seq: 1,
        });
      }
      if (request instanceof CurrentApi.messages.EditForumTopic) {
        assert.equal(decoded.topicId, 42);
        assert.equal(decoded.closed, false);
        assert.equal(decoded.hidden, true);
      } else {
        assert.ok(request instanceof CurrentApi.messages.DeleteTopicHistory);
        assert.equal(decoded.topMsgId, 42);
      }
      return new Api.Updates({ updates: [], users: [], chats: [], date: 1, seq: 1 });
    },
  };
  assert.deepEqual(await service.createForumTopic("100", "Topic", 6, "123"), { id: 42, title: "Topic" });
  await service.editForumTopic("100", 42, { closed: false, hidden: true });
  await service.deleteForumTopic("100", 42);
  assert.deepEqual(calls, ["messages.CreateForumTopic", "messages.EditForumTopic", "messages.DeleteTopicHistory"]);
});
