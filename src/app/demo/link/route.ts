import {NextResponse} from 'next/server';
export function GET(){return NextResponse.redirect('https://pinbot.annabuchy.com/demo/product',302);}
export const HEAD=GET;
