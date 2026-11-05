import { z } from 'zod';
import type { BrowsingPath, Scene } from './browsing';
export const mapCommandSchema = z.object({
  ownerId: z.string().min(1).max(256), entryId: z.string().min(1).max(256),
  kind: z.enum(['open','close','jump','remove','undo','select','new','continue','draft','orientation']),
  value: z.string().max(8192).optional(), nodeId: z.string().max(256).optional()
}).strict();
export type MapCommand = z.infer<typeof mapCommandSchema>;
export type MapState = { ownerId: string; entryId: string; scene: Scene; path: BrowsingPath; open: boolean;
  title: string; tabs: {id:string;title:string;count:number;last:string;ordinal:number}[]; orientation:'horizontal'|'vertical'; draft:string; draftNode?:string };
export type MapApi = { state():Promise<MapState>; command(command:MapCommand):Promise<void>; onState(callback:(state:MapState)=>void):void };
