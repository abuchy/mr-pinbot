import type {Metadata} from 'next';
import {PageHeading} from '@/components/page-parts';
import {DemoImport} from '@/components/demo-import';
export const metadata:Metadata={title:'HTTP import demo'};
export default function Demo(){return <><PageHeading eyebrow="SEE THE COMPLETE FLOW" title="Link → product → review." description="A permitted, first-party demonstration using real HTTP and product metadata."/><DemoImport/></>;}
