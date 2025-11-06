import DynamicOutlinePlugin from "main";
import { HeadingCache, MarkdownRenderer } from "obsidian";
import SearchContainer from "./searchContainer";
import Outline from "src/components/Outline";

export default class DynamicLiElement {
	private _plugin: DynamicOutlinePlugin;
	private _outline: Outline;

	private readonly COLLAPSE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon"><path d="m6 9 6 6 6-6"/></svg>`;

	constructor(plugin: DynamicOutlinePlugin, outline: Outline) {
		this._plugin = plugin;
		this._outline = outline;
	}

	createLiElement(
		heading: HeadingCache,
		tabLevel: number,
		headings: HeadingCache[],
		index: number,
		isCollapsingPossibleGlobally: boolean,
		hasMultipleTopLevelHeadings: boolean // New parameter
	): HTMLLIElement {
		const hasChildren: boolean =
			index + 1 < headings.length &&
			headings[index + 1].level > heading.level;
		const canCollapse: boolean =
			isCollapsingPossibleGlobally && hasChildren;
		const isSingleTopLevel: boolean =
			tabLevel === 1 && !hasMultipleTopLevelHeadings;

		const liClasses = [
			`tab-level-${tabLevel}`,
			`li-heading-level-${heading.level}`,
		];

		if (canCollapse) {
			liClasses.push("has-children");
		}

		if (isSingleTopLevel) {
			liClasses.push("is-single-top-level");
		}

		const liElement: HTMLLIElement = createEl("li", {
			cls: liClasses,
			attr: {
				"data-heading-line": heading.position.start.line,
				"data-level": tabLevel,
			},
		});

		if (isCollapsingPossibleGlobally && !isSingleTopLevel) {
			const iconSpan = createEl("span", {
				cls: "dynamic-outline-collapse-icon",
			});
			iconSpan.innerHTML = this.COLLAPSE_ICON_SVG;

			if (canCollapse) {
				iconSpan.addEventListener("click", (event) =>
					this._handleCollapseToggle(event)
				);
			} else {
				iconSpan.style.cursor = "default";
			}
			liElement.append(iconSpan);
		}

		const aElement = createEl("a", {
			cls: `heading-level-${heading.level}`,
		});

		// Render heading text with LaTeX math support (async, no await needed)
		this._renderHeadingWithMath(aElement, heading.heading);

		liElement.append(aElement);

		this._setupEventListener(liElement, heading);

		return liElement;
	}

	updateLiElementLine(liElement: HTMLLIElement, heading: HeadingCache): void {
		liElement.setAttribute(
			"data-heading-line",
			heading.position.start.line.toString()
		);
		this._setupEventListener(liElement, heading);
	}

	// TODO: the highlighted index should be on the top (scrollBlock="start")
	private _setupEventListener(
		liElement: HTMLLIElement,
		heading: HeadingCache
	) {
		liElement.onclick = (event) => {
			// Don't navigate if the icon was clicked
			if (
				(event.target as HTMLElement).closest(
					".dynamic-outline-collapse-icon"
				)
			) {
				return;
			}
			this._handleClick(heading);
		};

		liElement.addEventListener("mouseenter", () => {
			liElement.classList.add("hovered");
		});

		liElement.addEventListener("mouseleave", () => {
			liElement.classList.remove("hovered");
		});
	}

	private _handleCollapseToggle(event: MouseEvent): void {
		event.stopPropagation();

		const iconElement = event.currentTarget as HTMLElement;
		const liElement = iconElement.parentElement as HTMLLIElement;
		if (!liElement) return;

		const parentLevel: number = parseInt(liElement.dataset.level || "0");
		const isCollapsing = !liElement.classList.contains("collapsed");

		liElement.classList.toggle("collapsed");

		const elementsToProcess: HTMLLIElement[] = [];
		let currentElement: HTMLLIElement | null =
			liElement.nextElementSibling as HTMLLIElement | null;
		while (currentElement) {
			const currentLevel: number = parseInt(
				currentElement.dataset.level || "0"
			);
			if (currentLevel <= parentLevel) {
				break;
			}
			elementsToProcess.push(currentElement);
			currentElement =
				currentElement.nextElementSibling as HTMLLIElement | null;
		}

		requestAnimationFrame(() => {
			let visibilityDepthLimit = isCollapsing ? -1 : parentLevel + 1;

			elementsToProcess.forEach((el) => {
				const currentLevel = parseInt(el.dataset.level || "0");

				if (isCollapsing) {
					el.classList.add("hidden-by-collapse");
				} else {
					if (currentLevel <= visibilityDepthLimit) {
						el.classList.remove("hidden-by-collapse");
						visibilityDepthLimit = el.classList.contains(
							"collapsed"
						)
							? currentLevel
							: currentLevel + 1;
					} else {
						el.classList.add("hidden-by-collapse");
					}
				}
			});
		});
	}

	private _handleClick(heading: HeadingCache): void {
		if (!this._outline.view.file) return;

		this._navigateToHeading(heading);
		this._resetSearchField();

		// Focus the editor after navigation
		this._plugin.runCommand("editor:focus");
	}

	private _navigateToHeading(heading: HeadingCache): void {
		const file = this._outline.view.file;
		if (!file) return;

		// Open the file at the heading's line
		this._outline.view.leaf.openFile(file, {
			eState: { line: heading.position.start.line },
		});

		// Apply scroll after a small delay to ensure the view is ready
		setTimeout(() => {
			this._outline.view.currentMode.applyScroll(
				heading.position.start.line
			);
		}, 0);

		if (this._plugin.settings.hideOutlineOnJump) {
			this._outline.outlineWindow.hide();
		}
	}

	private _resetSearchField(): void {
		if (this._plugin.settings.disableSearchClearOnJump) return;

		const window = this._outline.outlineWindow;
		const searchContainerHTML: HTMLDivElement | null = window
			.getContainerElement()
			.querySelector(
				".dynamic-outline-search-container"
			) as HTMLDivElement | null;

		if (!searchContainerHTML) return;

		const searchContainer: SearchContainer = new SearchContainer(
			this._plugin,
			searchContainerHTML
		);

		searchContainer.clearInput(false);
		window.removeHovered();
	}

	/**
	 * Renders heading text with LaTeX math notation support.
	 * Only processes math delimiters, leaving other text as-is to avoid
	 * unwanted markdown parsing (e.g., "1. " being treated as a list).
	 */
	private async _renderHeadingWithMath(
		container: HTMLElement,
		text: string
	): Promise<void> {
		// Quick check: if no $ symbols, just render as plain text (fast path)
		if (!text.includes("$")) {
			container.appendText(text);
			return;
		}

		// Regex to match inline ($...$) and display ($$...$$) math
		// Note: This matches $$ first to avoid matching it as two separate $ delimiters
		const mathRegex = /(\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$)/g;

		let lastIndex = 0;
		let match;
		let foundMath = false;

		while ((match = mathRegex.exec(text)) !== null) {
			foundMath = true;
			// Add text before the math as plain text
			if (match.index > lastIndex) {
				container.appendText(text.substring(lastIndex, match.index));
			}

			// Render the math
			const mathText = match[0];
			const mathContent = mathText.replace(/^\$+|\$+$/g, ""); // Remove $ symbols
			const isDisplay = mathText.startsWith("$$");

			const mathEl = container.createSpan({
				cls: isDisplay ? "math math-block" : "math",
			});
			// Ensure math stays inline and doesn't break text selection
			mathEl.style.display = "inline";

			// Render using Obsidian's markdown renderer
			try {
				// Create a temporary container for rendering
				const tempDiv = createDiv();
				await MarkdownRenderer.renderMarkdown(
					isDisplay ? `$$${mathContent}$$` : `$${mathContent}$`,
					tempDiv,
					"",
					this._plugin
				);

				// Extract the actual math content, removing any wrapper paragraphs
				const renderedMath =
					tempDiv.querySelector(".math") ||
					tempDiv.querySelector("mjx-container");
				if (renderedMath) {
					// Ensure the rendered math displays inline
					if (renderedMath instanceof HTMLElement) {
						renderedMath.style.display = "inline";
					}
					mathEl.appendChild(renderedMath);
				} else {
					// If we can't find the rendered math, move all content
					while (tempDiv.firstChild) {
						// Skip paragraph wrappers
						if (
							tempDiv.firstChild.nodeName === "P" &&
							tempDiv.firstChild.firstChild
						) {
							while (tempDiv.firstChild.firstChild) {
								mathEl.appendChild(tempDiv.firstChild.firstChild);
							}
							tempDiv.firstChild.remove();
						} else {
							mathEl.appendChild(tempDiv.firstChild);
						}
					}
				}
			} catch (error) {
				// Fallback to showing the raw math text
				mathEl.appendText(mathText);
			}

			lastIndex = match.index + match[0].length;
		}

		// Add remaining text after the last math expression
		if (lastIndex < text.length) {
			container.appendText(text.substring(lastIndex));
		}

		// If no valid math was found (e.g., "Price is $5"), render as plain text
		if (!foundMath) {
			container.appendText(text);
		}
	}
}
