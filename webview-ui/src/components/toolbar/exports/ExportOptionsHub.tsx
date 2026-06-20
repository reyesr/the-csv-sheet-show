import { Accessor, Show } from "solid-js";
import { HtmlOptionsPane } from "./HtmlOptionsPane";
import { JsonOptionsPane } from "./JsonOptionsPane";
import { ExportController } from "../createExportController";


export function ExportOptionsHub(props: { ex: ExportController; ready: Accessor<boolean> }) {

    return (
        <div>
            <Show when={props.ex.format() === 'html'}>
                <HtmlOptionsPane html={props.ex.html} setHtml={props.ex.setHtml} />
            </Show>

            <Show when={props.ex.format() === 'json'}>
                <JsonOptionsPane json={props.ex.json} setJson={props.ex.setJson} />
            </Show>
            
        </div>
    )

}