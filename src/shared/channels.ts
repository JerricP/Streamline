/**
 * Request names shared by the main process and the web UI. Keeping them in
 * one frozen map stops the two sides from drifting.
 */

export const CHANNELS = {
  appInfo: 'app:info',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  lightingStatus: 'lighting:status',
  lightingApply: 'lighting:apply',

  driversLast: 'drivers:last',
  driversCheck: 'drivers:check',

  shellOpenExternal: 'shell:openExternal'
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
