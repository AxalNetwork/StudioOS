/**
 * D1311 (#2398, #2408) — the connector parts on Build's modules, in the order
 * the owner's canvases draw them (`design/incoming/Lovable Page.dc.html` and
 * `Lovable · Boards.dc.html`, LV1–LV8; `From Vercel Page.dc.html` and
 * `From Vercel · Boards.dc.html`, VC1–VC7; D1314: `Google Workspace Page.dc.html`,
 * GW1–GW8, and `Notion Page.dc.html`, NT1–NT8, with their board grids).
 *
 * A module can carry several parts now: GitHub's (D782), Vercel's,
 * Lovable's, Google's and Notion's. Each is one `[connector, render]` entry. A part not built yet is
 * `null` on its own line, named with the task that builds it, so that task
 * replaces its own line and no other: the five connector tasks do not edit the
 * same lines of CycleRoute.jsx.
 *
 * Each part renders inside its own boundary. One that throws reads
 * "could not be read" with Retry; the module and the other parts stay drawn.
 */
import { Component } from 'react';
import { Unreadable } from '../../ui';
import ToolsHistory from './ToolsHistory';
import SolutionDesignFromCode from './SolutionDesignFromCode';
import FoundingTeamFromCode from './FoundingTeamFromCode';
import CompanyFromCode from './CompanyFromCode';
import RoadmapFromGithub from './RoadmapFromGithub';
import MvpFromGithub from './MvpFromGithub';
import FromNotion from './FromNotion';
import HostingFromVercel from './HostingFromVercel';
import RunsOnFromVercel from './RunsOnFromVercel';

export const BUILD_PARTS = Object.freeze({
  'solution-design': [
    // D782 (#2114): Built with, proposals, notes, anchored at #from-github.
    ['github', (data, ctx) => <SolutionDesignFromCode part={data?.parts?.from_code} projectId={ctx.projectId} reload={ctx.reload} />],
    // VC4a "From Vercel · Runs on", under GitHub's part: #2962 (D1097), RunsOnFromVercel, #from-vercel.
    ['vercel', (data, ctx) => <RunsOnFromVercel part={data?.parts?.vercel_runtime} reload={ctx.reload} />],
    // GW3/GW6: spec Docs as proposals: #2958 (D1093), FromGoogle, #from-google.
    ['google', null],
    // NT3/NT6: spec pages as proposals (D1088, #2953), anchored at #from-notion.
    ['notion', (_data, ctx) => <FromNotion section="build" module="solution_design" projectId={ctx.projectId} />],
  ],
  'prototype-mvp': [
    // D782 (#2112): pull request states and release checks, anchored at #from-github.
    ['github', (data) => <MvpFromGithub github={data?.parts?.github} />],
    // VC2: the Live strip and each must-have's preview: #2963 (D1098), MvpFromVercel, #from-vercel.
    ['vercel', null],
    // LV7: From Lovable under From GitHub: #2948 (D1083), FromLovable, #from-lovable.
    ['lovable', null],
    // NT3: a must-have database as facts (D1088, #2953), anchored at #from-notion.
    ['notion', (_data, ctx) => <FromNotion section="build" module="prototype_mvp" projectId={ctx.projectId} />],
  ],
  'product-roadmap': [
    // VC3: the Deploys strip sits ABOVE GitHub's Releases strip: #2963 (D1098), RoadmapFromVercel, #from-vercel.
    ['vercel', null],
    // D782 (#2111): milestones and releases from GitHub, anchored at #from-github.
    ['github', (data) => <RoadmapFromGithub github={data?.parts?.github} />],
    // GW3: a mapped roadmap Sheet's rows: #2958 (D1093), FromGoogle, #from-google.
    ['google', null],
    // NT3: a roadmap database's rows (D1088, #2953), anchored at #from-notion.
    ['notion', (_data, ctx) => <FromNotion section="build" module="product_roadmap" projectId={ctx.projectId} />],
  ],
  'operating-systems': [
    // D686 §5.4: Tools history, with GitHub's Code system, anchored at #tools.
    ['tools', (data) => <ToolsHistory tools={data?.parts?.tools} />],
    // VC1: the Hosting block beside GitHub's Code system: #2962 (D1097), HostingFromVercel, #from-vercel.
    ['vercel', (data, ctx) => <HostingFromVercel hosting={data?.parts?.tools?.hosting} projectId={ctx.projectId} reload={ctx.reload} />],
  ],
  'founding-team': [
    // D782 (#2115): who builds (the founder matches each login) and where the code sits.
    ['github', (data, ctx) => <FoundingTeamFromCode part={data?.parts?.github} projectId={ctx.projectId} reload={ctx.reload} />],
  ],
  'company-creation': [
    ['github', (data, ctx) => <CompanyFromCode part={data?.parts?.github} projectId={ctx.projectId} reload={ctx.reload} />],
    // VC4b and VC4d "Where production runs" and the Accept dialog: #2964 (D1099), CompanyFromVercel, #from-vercel.
    ['vercel', null],
  ],
});

/** The parts a module draws, in order, with the unbuilt ones left out. */
export const builtParts = (slug) => (BUILD_PARTS[slug] || []).filter(([, render]) => typeof render === 'function');

export class PartBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div data-testid={`build-part-unreadable-${this.props.name}`}>
        <Unreadable what="This part" claim="The rest of this page is current." onRetry={() => this.setState({ failed: false })} />
      </div>
    );
  }
}

/** `{ slug: (data, ctx) => parts }`, the shape `toFnMap` takes for `build.parts`. */
export function buildPartsMap() {
  return Object.fromEntries(Object.keys(BUILD_PARTS).map((slug) => [slug, (data, ctx) => (
    <>
      {builtParts(slug).map(([key, render]) => (
        <PartBoundary key={key} name={`${slug}-${key}`}>{render(data, ctx)}</PartBoundary>
      ))}
    </>
  )]));
}
