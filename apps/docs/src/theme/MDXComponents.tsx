import type { ComponentProps } from "react";
import React from "react";
import MDXComponents from "@theme-original/MDXComponents";

export default {
  ...MDXComponents,
  // Tables fill the page and scroll sideways inside their card on a phone.
  table: (props: ComponentProps<"table">) => (
    <div className="table-card">
      <table {...props} />
    </div>
  ),
};
