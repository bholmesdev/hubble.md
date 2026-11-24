import type { SVGProps } from "react";

export function HubbleMark(props: SVGProps<SVGSVGElement>) {
	return (
		<svg viewBox="10 15 52 50" fill="none" aria-hidden="true" {...props}>
			<path
				d="M49.2026 59.0052L47.8342 59.2636C42.8143 60.2115 37.9764 56.9104 37.0285 51.8905L32.5926 28.3984C31.6449 23.3786 34.9458 18.5406 39.9657 17.5928L41.3341 17.3344C48.5246 15.9766 55.4545 20.7053 56.8125 27.8958L59.764 43.5268C61.1218 50.7175 56.3933 57.6474 49.2026 59.0052Z"
				fill="var(--background)"
				stroke="currentColor"
				strokeWidth="2.4"
			/>
			<path
				d="M20.9097 20.99L21.5921 20.8516C28.0583 19.5406 34.363 23.7196 35.6741 30.1858L39.4145 48.6336C40.7253 55.0997 36.5464 61.4045 30.0804 62.7156L29.398 62.854C23.3088 64.0886 17.3716 60.1529 16.1368 54.0638L12.1196 34.2512C10.885 28.1619 14.8204 22.2246 20.9097 20.99Z"
				fill="var(--background)"
				stroke="currentColor"
				strokeWidth="2.4"
			/>
			<rect
				x="29.8013"
				y="23"
				width="9"
				height="5"
				transform="rotate(34.0759 29.8013 23)"
				fill="var(--background)"
			/>
			<rect
				x="33"
				y="54.1758"
				width="9"
				height="5"
				transform="rotate(-52.8737 33 54.1758)"
				fill="var(--background)"
			/>
			<circle
				cx="40.4095"
				cy="39.4095"
				r="12.754"
				transform="rotate(3.89346 40.4095 39.4095)"
				fill="currentColor"
			/>
			<circle
				cx="42.9108"
				cy="36.9264"
				r="6.5"
				transform="rotate(3.89346 42.9108 36.9264)"
				fill="var(--background)"
			/>
		</svg>
	);
}
