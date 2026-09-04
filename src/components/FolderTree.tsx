import { memo, useEffect, useState } from "react";
import { desktop } from "../desktop/api";

type Node = { name: string; path: string };
type Props = {
  /** Devuelve los archivos de audio/video de la carpeta elegida. */
  onOpenFolder: (paths: string[], folderPath: string) => void;
  activeFolder: string | null;
};

export const FolderTree = memo(function FolderTree({ onOpenFolder, activeFolder }: Props) {
  const api = desktop();
  const [roots, setRoots] = useState<Node[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, Node[]>>({});

  useEffect(() => {
    if (!api?.fsRoots) return;
    void api.fsRoots().then(setRoots);
  }, [api]);

  const listDir = async (path: string) => {
    if (!api?.fsListDir) return;
    const res = await api.fsListDir(path);
    setChildren((c) => ({ ...c, [path]: res.dirs }));
    onOpenFolder(res.files, path);
  };

  const toggle = (path: string) => {
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (!children[path]) void listDir(path);
      }
      return next;
    });
    void listDir(path);
  };

  if (!api?.fsRoots) {
    return (
      <div className="folder-tree empty-tree">
        <p>El árbol de carpetas necesita la app de escritorio.</p>
      </div>
    );
  }

  const renderNodes = (nodes: Node[], depth: number) =>
    nodes.map((n) => (
      <div key={n.path}>
        <button
          className={`folder-row ${activeFolder === n.path ? "on" : ""}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => toggle(n.path)}
          title={n.path}
        >
          <span className="folder-caret">{expanded.has(n.path) ? "▾" : "▸"}</span>
          <span className="folder-name">{n.name}</span>
        </button>
        {expanded.has(n.path) && children[n.path] ? renderNodes(children[n.path]!, depth + 1) : null}
      </div>
    ));

  return (
    <div className="folder-tree">
      <div className="folder-tree-head">Carpetas</div>
      <div className="folder-tree-body">{renderNodes(roots, 0)}</div>
    </div>
  );
});
