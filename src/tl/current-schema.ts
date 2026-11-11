import type { TelegramClient } from "telegram";
import type { EntityLike } from "telegram/define.js";
import { Api } from "telegram/tl/index.js";

/** The pinned GramJS runtime uses layer 233 while its bundled declarations are layer 198. */
export type SchemaObject<Args = object> = Args & { className: string; getBytes(): Buffer };
type SchemaConstructor<Args> = new (args: Args) => SchemaObject<Args>;
type EmptySchemaConstructor = new () => SchemaObject;
type SchemaRequest<Args, Result> = SchemaObject<Args> & { __response: Result };
type RequestConstructor<Args, Result> = new (args: Args) => SchemaRequest<Args, Result>;

type ForumPeer = Api.TypeInputPeer | Api.Channel;
type ForumOffsets = {
  peer: ForumPeer;
  limit: number;
  offsetDate: number;
  offsetId: number;
  offsetTopic: number;
  q?: string;
};
type InlineAction = SchemaObject & {
  data?: Buffer;
  requiresPassword?: boolean;
  url?: string;
  buttonId?: number;
  query?: string;
  samePeer?: boolean;
  userId?: Api.long;
  copyText?: string;
};
type RegularAction = SchemaObject & { quiz?: boolean; buttonId?: number; url?: string };
export type CurrentInlineButton = SchemaObject<{ text: string; type: InlineAction; style?: CurrentButtonStyle }>;
export type CurrentRegularButton = SchemaObject<{ text: string; type: RegularAction; style?: CurrentButtonStyle }>;
export type CurrentStarsTonAmount = SchemaObject<{ amount: Api.long }>;
export type CurrentPoll = Api.Poll & { hash: Api.long };
type PaidReactionPrivacy = SchemaObject;
type CurrentButtonStyle = SchemaObject<{
  bgPrimary?: boolean;
  bgDanger?: boolean;
  bgSuccess?: boolean;
  icon?: Api.long;
}>;

/** These are the actual generated layer 233 names and fields, not aliases to old protocol types. */
export const CurrentApi = Api as unknown as {
  Poll: new (args: ConstructorParameters<typeof Api.Poll>[0] & { hash: Api.long }) => CurrentPoll;
  InputMediaPoll: new (
    args: Omit<ConstructorParameters<typeof Api.InputMediaPoll>[0], "correctAnswers"> & { correctAnswers?: number[] },
  ) => Api.InputMediaPoll;
  PaidReactionPrivacyAnonymous: EmptySchemaConstructor;
  PaidReactionPrivacyDefault: EmptySchemaConstructor;
  PaidReactionPrivacyPeer: SchemaConstructor<{ peer: Api.TypeInputPeer }>;
  UpdatePaidReactionPrivacy: SchemaConstructor<{ private: PaidReactionPrivacy }>;
  channels: {
    ToggleForum: RequestConstructor<
      {
        channel: Api.TypeInputChannel | Api.Channel;
        enabled: boolean;
        tabs: boolean;
        sidebar: boolean;
      },
      Api.TypeUpdates
    >;
  };
  StarsTonAmount: SchemaConstructor<{ amount: Api.long }>;
  messages: {
    GetPollResults: RequestConstructor<{ peer: EntityLike; msgId: number; pollHash: Api.long }, Api.TypeUpdates>;
    SendPaidReaction: RequestConstructor<
      { peer: EntityLike; msgId: number; count: number; randomId: Api.long; private?: PaidReactionPrivacy },
      Api.TypeUpdates
    >;
    TogglePaidReactionPrivacy: RequestConstructor<
      { peer: EntityLike; msgId: number; private: PaidReactionPrivacy },
      boolean
    >;
    GetForumTopics: RequestConstructor<ForumOffsets, Api.messages.ForumTopics>;
    CreateForumTopic: RequestConstructor<
      {
        peer: ForumPeer;
        title: string;
        iconColor?: number;
        iconEmojiId?: Api.long;
        randomId: Api.long;
      },
      Api.TypeUpdates
    >;
    EditForumTopic: RequestConstructor<
      {
        peer: ForumPeer;
        topicId: number;
        title?: string;
        iconEmojiId?: Api.long;
        closed?: boolean;
        hidden?: boolean;
      },
      Api.TypeUpdates
    >;
    DeleteTopicHistory: RequestConstructor<{ peer: ForumPeer; topMsgId: number }, Api.messages.AffectedHistory>;
  };
  account: {
    UpdateColor: RequestConstructor<{ forProfile?: boolean; color?: Api.TypePeerColor }, boolean>;
  };
  KeyboardInlineButton: SchemaConstructor<{ text: string; type: InlineAction; style?: CurrentButtonStyle }>;
  KeyboardInlineButtonRow: SchemaConstructor<{ buttons: CurrentInlineButton[] }>;
  KeyboardButton: SchemaConstructor<{ text: string; type: RegularAction; style?: CurrentButtonStyle }>;
  KeyboardButtonStyle: SchemaConstructor<{
    bgPrimary?: boolean;
    bgDanger?: boolean;
    bgSuccess?: boolean;
    icon?: Api.long;
  }>;
  InlineButtonTypeCallback: SchemaConstructor<{ data: Buffer; requiresPassword?: boolean }>;
  InlineButtonTypeUrl: SchemaConstructor<{ url: string }>;
  InlineButtonTypeUrlAuth: SchemaConstructor<{ url: string; buttonId: number; fwdText?: string }>;
  InlineButtonTypeSwitchInline: SchemaConstructor<{ query: string; samePeer?: boolean }>;
  InlineButtonTypeWebView: SchemaConstructor<{ url: string }>;
  InlineButtonTypeUserProfile: SchemaConstructor<{ userId: Api.long }>;
  InlineButtonTypeCopy: SchemaConstructor<{ copyText: string }>;
  InlineButtonTypeGame: EmptySchemaConstructor;
  InlineButtonTypeBuy: EmptySchemaConstructor;
  InlineButtonTypeDisabled: EmptySchemaConstructor;
  ButtonTypeDefault: EmptySchemaConstructor;
  ButtonTypeRequestPhone: EmptySchemaConstructor;
  ButtonTypeRequestGeoLocation: EmptySchemaConstructor;
  ButtonTypeRequestPoll: SchemaConstructor<{ quiz?: boolean }>;
  ButtonTypeRequestPeer: SchemaConstructor<{ buttonId: number; peerType: unknown; maxQuantity: number }>;
  ButtonTypeSimpleWebView: SchemaConstructor<{ url: string }>;
};

/** Narrow the stale generated declaration at the transport boundary only. */
export async function invokeCurrent<Args, Result>(
  client: Pick<TelegramClient, "invoke">,
  request: SchemaRequest<Args, Result>,
): Promise<Result> {
  return client.invoke(request as unknown as Api.AnyRequest) as Promise<Result>;
}
