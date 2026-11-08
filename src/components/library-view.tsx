"use client";
import { useState } from "react";
import { Icon } from "./icons";
import { EmptyState } from "./page-parts";
const filters = ["All content", "Drafts", "Ready for review", "Published"];
export function LibraryView() {
  const [filter, setFilter] = useState("All content");
  const [query, setQuery] = useState("");
  return <><div className="library-toolbar"><div className="filters" role="group" aria-label="Filter content by status">{filters.map(label => <button key={label} className={`filter ${filter === label ? "selected" : ""}`} aria-pressed={filter === label} onClick={() => setFilter(label)}>{label}<span>0</span></button>)}</div><label className="search-box"><Icon name="search" size={17}/><span className="sr-only">Search content</span><input type="search" placeholder="Search your library" value={query} onChange={event => setQuery(event.target.value)}/></label></div><section className="section-panel library-empty" aria-label={`${filter} results`} aria-live="polite"><div className="section-header"><span className="muted">{filter}</span><span className="muted">0 items</span></div><EmptyState icon="library" title={query.trim() ? "No matching content." : filter === "All content" ? "Every good Pin starts with a find." : `No ${filter.toLowerCase()} yet.`}>{query.trim() ? "Try another search, or clear it to return to your library." : "Your content will live here once imports and drafts are connected."}</EmptyState>{query.trim() && <button className="button quiet" onClick={() => setQuery("")}>Clear search</button>}</section><div className="explanation-row"><span className="mini-highlight"><Icon name="pin" size={21}/></span><div><h2>A collection with intention.</h2><p>Product details, imagery, and affiliate links will stay together, so you can focus on creating something worth saving.</p></div></div></>;
}
