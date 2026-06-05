export enum MaimaiBonusType {
  Partner = 'Partner',
  Chara = 'Chara',
  Music = 'Music',
  Title = 'Title',
  Plate = 'Plate',
  Icon = 'Icon',
  Frame = 'Frame',
  Ticket = 'Ticket',
}

export type MaimaiLoginBonusMetadataExtra = {
  reward: { kind: MaimaiBonusType; id: number };
  maxPoint: number;
  isCollabo: boolean;
  priority: number;
};
